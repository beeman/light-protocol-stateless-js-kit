import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { LocalSolanaClient } from '@beeman/testcontainers'
import { createLocalSolanaClient, type StartedSurfpoolContainer, SurfpoolContainer } from '@beeman/testcontainers'
import { type Address, airdropFactory, generateKeyPairSigner, lamports } from '@solana/kit'
import { sendAndConfirmInstructions } from '../src/index.ts'

/**
 * E2E tests using Surfpool via testcontainers.
 *
 * These tests spin up a Surfpool container (Solana simulator) and run
 * real RPC calls against it. Requires Docker to be running.
 *
 * To use solana-test-validator instead of Surfpool, replace:
 *   import { SurfpoolContainer } from '@beeman/testcontainers'
 * with:
 *   import { SolanaTestValidatorContainer } from '@beeman/testcontainers'
 * and change `new SurfpoolContainer()` to `new SolanaTestValidatorContainer()`.
 * The client API is identical.
 */
describe('e2e: Surfpool', () => {
  let container: StartedSurfpoolContainer | undefined
  let client: LocalSolanaClient

  beforeAll(async () => {
    container = await new SurfpoolContainer().start()
    client = await createLocalSolanaClient({ container })
  }, 120_000)

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  it('should respond to getHealth', async () => {
    const result = await client.rpc.getHealth().send()

    expect(result).toBe('ok')
  })

  it('should respond to getVersion', async () => {
    const result = await client.rpc.getVersion().send()

    expect(result).toHaveProperty('solana-core')
    expect(result).toHaveProperty('feature-set')
  })

  it('should respond to getSlot', async () => {
    const result = await client.rpc.getSlot().send()

    expect(typeof result).toBe('bigint')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('should get balance of a new keypair (0 SOL)', async () => {
    const keypair = await generateKeyPairSigner()
    const result = await client.rpc.getBalance(keypair.address).send()

    expect(result.value).toEqual(lamports(0n))
  })

  it('should send a memo transaction using sendAndConfirmInstructions', async () => {
    const feePayer = await generateKeyPairSigner()
    const airdrop = airdropFactory({
      rpc: client.rpc,
      rpcSubscriptions: client.rpcSubscriptions,
    })
    await airdrop({
      commitment: 'confirmed',
      lamports: lamports(1_000_000_000n),
      recipientAddress: feePayer.address,
    })

    const signature = await sendAndConfirmInstructions({
      feePayer,
      instructions: [
        {
          data: new TextEncoder().encode('light-system-sdk-e2e'),
          programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address,
        },
      ],
      rpcClient: {
        rpc: client.rpc,
        rpcSubscriptions: client.rpcSubscriptions,
      },
    })

    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/)
  })
})
