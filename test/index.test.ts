import { describe, expect, test } from 'bun:test'
import { AccountRole, type Address, generateKeyPairSigner } from '@solana/kit'
import {
  buildAndSignTransaction,
  createLightSystemProgramSdk,
  createSolanaClient,
  DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS,
  DEFAULT_NOOP_PROGRAM_ADDRESS,
  DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS,
  deriveAccountCompressionAuthority,
  getExplorerUrl,
  getLightSystemAccountMetasV2,
  getWsUrl,
  PackedAccounts,
  SystemAccountMetaConfig,
  sendAndConfirmInstructions,
} from '../src/index.ts'

describe('getWsUrl', () => {
  test('converts https:// to wss://', () => {
    expect(getWsUrl('https://api.devnet.solana.com')).toBe('wss://api.devnet.solana.com')
  })

  test('converts http:// to ws://', () => {
    expect(getWsUrl('http://localhost:8899')).toBe('ws://localhost:8900')
  })

  test('maps port 8899 to 8900', () => {
    expect(getWsUrl('http://127.0.0.1:8899')).toBe('ws://127.0.0.1:8900')
  })

  test('leaves non-8899 ports unchanged', () => {
    expect(getWsUrl('https://custom-rpc.example.com:443')).toBe('wss://custom-rpc.example.com:443')
  })
})

describe('createSolanaClient', () => {
  test('returns a client with rpc and rpcSubscriptions', () => {
    const client = createSolanaClient({ url: 'https://api.devnet.solana.com' })
    expect(client.rpc).toBeDefined()
    expect(client.rpcSubscriptions).toBeDefined()
  })
})

describe('getExplorerUrl', () => {
  test('returns correct URL for devnet', () => {
    expect(getExplorerUrl('tx/abc123', 'devnet')).toBe('https://explorer.solana.com/tx/abc123?cluster=devnet')
  })

  test('returns correct URL for mainnet-beta (no cluster param)', () => {
    expect(getExplorerUrl('account/abc123', 'mainnet-beta')).toBe('https://explorer.solana.com/account/abc123')
  })
})

describe('createLightSystemProgramSdk', () => {
  const programAddress = 'SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7' as Address

  test('buildInvokeInstruction fills common defaults and appends remaining accounts', async () => {
    const sdk = createLightSystemProgramSdk({ programAddress })
    const feePayer = await generateKeyPairSigner()
    const authority = await generateKeyPairSigner()
    const remainingAccount = {
      address: feePayer.address,
      role: AccountRole.READONLY,
    } as const

    const instruction = await sdk.buildInvokeInstruction({
      authority,
      feePayer,
      inputs: new Uint8Array([1, 2, 3]),
      remainingAccounts: [remainingAccount],
    })

    expect(instruction.programAddress).toBe(programAddress)
    expect(instruction.accounts).toHaveLength(10)
    expect(instruction.accounts[2]?.address).toBe(DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS)
    expect(instruction.accounts[3]?.address).toBe(DEFAULT_NOOP_PROGRAM_ADDRESS)
    expect(instruction.accounts[5]?.address).toBe(DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS)
    expect(instruction.accounts[9]).toEqual(remainingAccount)
  })

  test('deriveAccountCompressionAuthority returns a PDA', async () => {
    const authority = await deriveAccountCompressionAuthority(programAddress)
    expect(authority).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })
})

describe('PackedAccounts', () => {
  const selfProgram = '11111111111111111111111111111111' as Address
  const lightSystemProgram = 'SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7' as Address

  test('inserts accounts once and tracks offsets', async () => {
    const config = SystemAccountMetaConfig.new(selfProgram)
    const packedAccounts = await PackedAccounts.newWithSystemAccountsV2(config, {
      lightSystemProgram,
    })

    const mutableIndex = packedAccounts.insertOrGet(selfProgram)
    const duplicateIndex = packedAccounts.insertOrGet(selfProgram)
    const readonlyIndex = packedAccounts.insertOrGetReadOnly(lightSystemProgram)

    expect(mutableIndex).toBe(0)
    expect(duplicateIndex).toBe(0)
    expect(readonlyIndex).toBe(1)

    const metas = packedAccounts.toAccountMetas()
    expect(metas.systemStart).toBe(0)
    expect(metas.packedStart).toBeGreaterThan(0)
    expect(metas.remainingAccounts.length).toBe(metas.packedStart + 2)
  })

  test('getLightSystemAccountMetasV2 returns expected static account ordering', async () => {
    const metas = await getLightSystemAccountMetasV2(SystemAccountMetaConfig.new(selfProgram), {
      lightSystemProgram,
    })

    expect(metas[0]?.address).toBe(lightSystemProgram)
    expect(metas[2]?.address).toBe(DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS)
    expect(metas[4]?.address).toBe(DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS)
  })
})

describe('transaction helpers', () => {
  test('buildAndSignTransaction signs with provided blockhash', async () => {
    const feePayer = await generateKeyPairSigner()
    const transaction = await buildAndSignTransaction({
      feePayer,
      instructions: [
        {
          data: new Uint8Array([1]),
          programAddress: '11111111111111111111111111111111' as Address,
        },
      ],
      latestBlockhash: {
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 1n,
      },
    })

    expect(transaction).toBeDefined()
  })

  test('sendAndConfirmInstructions uses injected sender and returns signature', async () => {
    const feePayer = await generateKeyPairSigner()
    let called = false

    const signature = await sendAndConfirmInstructions({
      feePayer,
      instructions: [
        {
          data: new Uint8Array([1, 2]),
          programAddress: '11111111111111111111111111111111' as Address,
        },
      ],
      latestBlockhash: {
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 2n,
      },
      sendAndConfirmTransaction: async () => {
        called = true
      },
    })

    expect(called).toBe(true)
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/)
  })
})
