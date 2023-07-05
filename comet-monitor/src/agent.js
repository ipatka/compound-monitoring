const { ethers, Finding, FindingSeverity, FindingType, getEthersProvider } = require('forta-agent')
const BigNumber = require('bignumber.js')
const axios = require('axios')

const cometABI = require('../abi/CometMainInterface.json')
const erc20ABI = require('../abi/ERC20.json')

const COMET_ADDRESS = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
// set up a variable to hold initialization data used in the handler
const initializeData = {}

const cometEvents = {
    Supply: {
        type: 'Info',
        severity: 'Info',
        amountKey: 'amount',
    },
    SupplyCollateral: {
        type: 'Info',
        severity: 'Info',
        assetKey: 'asset',
        amountKey: 'amount',
    },
    Withdraw: {
        type: 'Info',
        severity: 'Info',
        amountKey: 'amount',
    },
    WithdrawCollateral: {
        type: 'Info',
        severity: 'Info',
        assetKey: 'asset',
        amountKey: 'amount',
    },
}

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

function createAlert(name, symbol, amount, usdValue, protocolVersion) {
    return Finding.fromObject({
        name: 'Compound V3 Market Monitor',
        description: `The ${name} event was emitted by the Comet contract`,
        alertId: 'AE-COMET-EVENT',
        type: FindingType.Info,
        severity: FindingSeverity.Info,
        metadata: {
            symbol,
            amount,
            usdValue,
            protocolVersion,
        },
    })
}

// NEW
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
    const decimals = await contract.decimals()

    return {
        contract,
        symbol,
        address,
        decimals,
    }
}

// function provideInitialize(data) {
//     return async function initialize() {
//         /* eslint-disable no-param-reassign */
//         // request the ethers provider from the forta sdk
//         const provider = getEthersProvider()
//         const iface = new ethers.utils.Interface(anchoredViewAbi)
//         // initialize the UniswapAnchoredView contract
//         data.contract = new ethers.Contract(UNI_ANCHORED_VIEW_ADDRESS, anchoredViewAbi, provider)
//         data.priceGuardedEvent = iface.getEvent('PriceGuarded').format(ethers.utils.FormatTypes.full)
//         // UniswapAnchoredView price feed contract is only used in Compound v2
//         data.protocolVersion = '2'
//         /* eslint-enable no-param-reassign */
//     }
// }
function provideInitialize(data) {
    return async function initialize() {
        /* eslint-disable no-param-reassign */
        // assign configurable fields
        data.provider = getEthersProvider()
        const cometInterface = new ethers.utils.Interface(cometABI)
        // initialize the Comet contract
        data.cometContract = new ethers.Contract(COMET_ADDRESS, cometABI, data.provider)
        data.events = getEventInfo(cometInterface, cometEvents, ethers.utils.FormatTypes.full)
        // Comet is v3
        data.protocolVersion = '3'
        // Store abi for parsing collateral
        data.collateralABI = erc20ABI
        // Skip contract call on initialization
        data.baseAssetInfo = {
            symbol: 'USDC',
            address: USDC_ADDRESS,
            decimals: new BigNumber(6),
        }
    }
}

function provideHandleTransaction(data) {
    return async function handleTransaction(txEvent) {
        const { events, protocolVersion, provider, baseAssetInfo, collateralABI } = data

        const signatures = events.map((entry) => entry.signature)
        // Look for relevant event signatures
        const parsedLogs = txEvent.filterLog(signatures, COMET_ADDRESS)

        const promises = parsedLogs.map(async (log) => {
            const { name } = log
            const [specificEvent] = events.filter((entry) => entry.name === name)
            let tokenInfo
            // If collateral asset
            if (name.includes('Collateral')) {
                const collateralAddress = log.args[specificEvent.assetKey]
                tokenInfo = await getCollateralTokenInfo(collateralAddress, collateralABI, provider)
                // If base asset
            } else {
                tokenInfo = baseAssetInfo
            }

            // Get amount as string
            // const amount = log.args[specificEvent.amountKey].toString()
            const amount = new BigNumber(log.args[specificEvent.amountKey].toString())
            const usdPerToken = await getTokenPrice(tokenInfo.address)
            const divisor = new BigNumber(10).pow(tokenInfo.decimals.toNumber())
            const normalizedAmount = amount.div(divisor)
            const value = usdPerToken.times(normalizedAmount).integerValue(BigNumber.ROUND_FLOOR)
            // const { symbol, underlyingDecimals, underlyingTokenAddress } = tokenInfo
            const { symbol } = tokenInfo

            return createAlert(name, symbol, normalizedAmount.toString(), value, protocolVersion)
        })

        const findings = (await Promise.all(promises)).flat()
        console.log(JSON.stringify(findings, null, 2))
        return findings
    }
}

module.exports = {
    COMET_ADDRESS,
    USDC_ADDRESS,
    initialize: provideInitialize(initializeData),
    provideHandleTransaction,
    handleTransaction: provideHandleTransaction(initializeData),
}
