const { Finding, FindingSeverity, FindingType, ethers, getEthersBatchProvider } = require('forta-agent')

const BigNumber = require('bignumber.js')
const axios = require('axios')

const { getAbi, extractEventArgs } = require('./utils')

// load any bot configuration parameters
const config = require('../bot-config.json')

// set up a variable to hold initialization data used in the handler
const initializeData = {}

async function getTokenPrice(tokenAddress) {
    const coingeckoApiUrl = 'https://api.coingecko.com/api/v3/simple/token_price/ethereum?'
    const addressQuery = `contract_addresses=${tokenAddress}`
    const vsCurrency = '&vs_currencies=usd'

    // create the URL
    const url = coingeckoApiUrl.concat(addressQuery.concat(vsCurrency))

    // get the price from the CoinGecko API
    const { data } = await axios.get(url)

    // parse the response and convert the prices to BigNumber.js type
    const usdPerToken = new BigNumber(data[tokenAddress.toLowerCase()].usd)

    return usdPerToken
}

async function emojiForEvent(eventName, value) {
    // create the appropriate number of whale emoji for the value
    // add one whale for each power of 1000
    const numWhales = Math.floor((value.toString().length - 1) / 3)
    const whaleString = '🐳'.repeat(numWhales)

    switch (eventName) {
        case 'Withdraw':
            return whaleString.concat('📉')
        case 'WithdrawCollateral':
            return whaleString.concat('📉')
        case 'Supply':
            return whaleString.concat('📈')
        case 'SupplyCollateral':
            return whaleString.concat('📈')
        default:
            return ''
    }
}

// helper function to create cToken alerts
async function createAlert(
    eventName,
    symbol,
    contractAddress,
    eventType,
    eventSeverity,
    usdValue,
    args,
    decimals,
    protocolName,
    protocolAbbreviation,
    developerAbbreviation,
    protocolVersion,
    emojiString
) {
    const eventArgs = extractEventArgs(args)
    const finding = Finding.fromObject({
        name: `${protocolName} Token Event`,
        description: `${emojiString} - The ${eventName} event was emitted by the ${protocolAbbreviation} contract`,
        alertId: `${developerAbbreviation}-${protocolAbbreviation}-CTOKEN-EVENT`,
        type: FindingType[eventType],
        severity: FindingSeverity[eventSeverity],
        protocol: protocolName,
        metadata: {
            symbol,
            contractAddress,
            decimals,
            eventName,
            usdValue,
            protocolVersion,
            ...eventArgs,
        },
    })
    return finding
}

function getEventInfo(iface, events, sigType) {
    const result = Object.entries(events).map(([eventName, entry]) => {
        const signature = iface.getEvent(eventName).format(sigType)
        return {
            name: eventName,
            signature,
            type: entry.type,
            severity: entry.severity,
            assetKey: entry.assetKey,
            amountKey: entry.amountKey,
        }
    })
    return result
}

async function getCollateralTokenInfo(address, abi, provider) {
    const contract = new ethers.Contract(address, abi, provider)
    const symbol = await contract.symbol()
    const underlyingDecimals = await contract.decimals()

    return {
        contract,
        symbol,
        underlyingTokenAddress: address,
        underlyingDecimals,
    }
}

async function getTokenInfo(address, abi, underlyingAbi, provider) {
    const contract = new ethers.Contract(address, abi, provider)

    const underlyingTokenAddress = await contract.baseToken()

    const underlyingContract = new ethers.Contract(underlyingTokenAddress, underlyingAbi, provider)

    const underlyingDecimals = await underlyingContract.decimals()
    const underlyingSymbol = await underlyingContract.symbol()

    return {
        contract,
        symbol: underlyingSymbol,
        underlyingTokenAddress,
        underlyingDecimals,
    }
}

function provideInitialize(data) {
    return async function initialize() {
        /* eslint-disable no-param-reassign */
        // assign configurable fields
        data.protocolName = config.protocolName
        data.protocolAbbreviation = config.protocolAbbreviation
        data.developerAbbreviation = config.developerAbbreviation

        data.provider = getEthersBatchProvider()

        const { Comet: comet, Collateral: collateral } = config.contracts
        data.protocolVersion = '3'

        // from the Comptroller contract, get all of the cTokens
        const cometABI = getAbi(comet.abiFile)
        data.cometContract = new ethers.Contract(comet.address, cometABI, data.provider)

        const collateralABI = getAbi(collateral.abiFile)

        const cometInterface = new ethers.utils.Interface(cometABI)
        const sigTypeFull = ethers.utils.FormatTypes.full
        const { events: cometEvents } = comet
        data.cometAddress = comet.address
        data.cometInfo = getEventInfo(cometInterface, cometEvents, sigTypeFull)
        data.cometTokenInfo = await getTokenInfo(comet.address, cometABI, collateralABI, data.provider)
        data.collateralABI = collateralABI
    }
}

function provideHandleTransaction(data) {
    return async function handleTransaction(txEvent) {
        const {
            cometAddress,
            cometInfo,
            cometTokenInfo,
            protocolName,
            protocolAbbreviation,
            developerAbbreviation,
            collateralABI,
            protocolVersion,
            provider,
        } = data

        const signatures = cometInfo.map((entry) => entry.signature)
        const parsedLogs = txEvent.filterLog(signatures, cometAddress)

        const promises = parsedLogs.map(async (log) => {
            const { address, name } = log
            const [specificEvent] = cometInfo.filter((entry) => entry.name === name)

            let tokenInfo
            // If collateral asset
            if (name.includes('Collateral')) {
                const collateralAddress = log.args[specificEvent.assetKey]
                tokenInfo = await getCollateralTokenInfo(collateralAddress, collateralABI, provider)
                // If base asset
            } else {
                tokenInfo = cometTokenInfo
            }

            const { symbol, underlyingDecimals, underlyingTokenAddress } = tokenInfo

            // convert an ethers BigNumber to a bignumber.js BigNumber
            const amount = new BigNumber(log.args[specificEvent.amountKey].toString())

            // get the conversion rate for this token to USD
            const usdPerToken = await getTokenPrice(underlyingTokenAddress)

            const divisor = new BigNumber(10).pow(underlyingDecimals.toNumber())
            const normalizedAmount = amount.div(divisor)

            const value = usdPerToken.times(normalizedAmount).integerValue(BigNumber.ROUND_FLOOR)

            const emojiString = await emojiForEvent(name, value)

            const promise = createAlert(
                name,
                symbol,
                address,
                specificEvent.type,
                specificEvent.severity,
                value.toString(),
                log.args,
                underlyingDecimals.toString(),
                protocolName,
                protocolAbbreviation,
                developerAbbreviation,
                protocolVersion,
                emojiString
            )
            return promise
        })

        const findings = await Promise.all(promises)
        return findings
    }
}

module.exports = {
    provideInitialize,
    initialize: provideInitialize(initializeData),
    provideHandleTransaction,
    handleTransaction: provideHandleTransaction(initializeData),
}
