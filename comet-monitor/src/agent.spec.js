// mock definitions for UniswapAnchoredView contract
const mockContract = {}

// combine the mocked provider and contracts into the ethers import mock
jest.mock('forta-agent', () => ({
    ...jest.requireActual('forta-agent'),
    getEthersProvider: jest.fn(),
    ethers: {
        ...jest.requireActual('ethers'),
        Contract: jest.fn().mockReturnValue(mockContract),
    },
}))

// local definitions

// bot tests
describe('handleTransaction', () => {
    it('mock', () => {
        expect(true)
    })
})
