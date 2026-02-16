import {
  type AccountMeta,
  AccountRole,
  type Address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createTransactionMessage,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from '@solana/kit'
import {
  getInitCpiContextAccountInstruction,
  getInvokeCpiInstruction,
  getInvokeCpiWithReadOnlyInstruction,
  getInvokeInstruction,
  type InitCpiContextAccountInput,
  type InvokeCpiInput,
  type InvokeCpiWithReadOnlyInput,
  type InvokeInput,
} from '../generated/index.ts'

export const DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS =
  '35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh' as Address<'35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh'>
export const DEFAULT_NOOP_PROGRAM_ADDRESS =
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV' as Address<'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'>
export const DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS =
  'compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq' as Address<'compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq'>
export const DEFAULT_SYSTEM_PROGRAM_ADDRESS =
  '11111111111111111111111111111111' as Address<'11111111111111111111111111111111'>
export const CPI_AUTHORITY_SEED = 'cpi_authority'

export type LightSystemProgramCommonAccounts = {
  accountCompressionAuthority?: Address
  accountCompressionProgram?: Address
  noopProgram?: Address
  registeredProgramPda?: Address
}

type WithRemainingAccounts = {
  remainingAccounts?: readonly AccountMeta[]
}

export type BuildInvokeInstructionInput = Omit<
  InvokeInput,
  'accountCompressionAuthority' | 'accountCompressionProgram' | 'noopProgram' | 'registeredProgramPda'
> &
  LightSystemProgramCommonAccounts &
  WithRemainingAccounts

export type BuildInvokeCpiInstructionInput = Omit<
  InvokeCpiInput,
  'accountCompressionAuthority' | 'accountCompressionProgram' | 'noopProgram' | 'registeredProgramPda'
> &
  LightSystemProgramCommonAccounts &
  WithRemainingAccounts

export type BuildInvokeCpiWithReadOnlyInstructionInput = Omit<
  InvokeCpiWithReadOnlyInput,
  'accountCompressionAuthority' | 'accountCompressionProgram' | 'noopProgram' | 'registeredProgramPda'
> &
  LightSystemProgramCommonAccounts &
  WithRemainingAccounts

export type CreateLightSystemProgramSdkInput = {
  defaults?: LightSystemProgramCommonAccounts
  programAddress: Address
}

export type SystemAccountMetaConfigInput = {
  cpiContext?: Address
  selfProgram: Address
  solCompressionRecipient?: Address
  solPoolPda?: Address
}

type PackedMeta = readonly [index: number, meta: AccountMeta]
type BlockhashLifetimeConstraint = {
  blockhash: string
  lastValidBlockHeight: bigint
}
type GetLatestBlockhashApi = {
  getLatestBlockhash: () => {
    send: () => Promise<BlockhashLifetimeConstraint | { value: BlockhashLifetimeConstraint }>
  }
}

export type BuildAndSignTransactionInput = {
  feePayer: TransactionSigner
  instructions: readonly {
    accounts?: readonly AccountMeta[]
    data?: Uint8Array
    programAddress: Address
  }[]
  latestBlockhash?: BlockhashLifetimeConstraint
  rpc?: GetLatestBlockhashApi
  version?: 0 | 'legacy'
}

export type SendAndConfirmInstructionsInput = BuildAndSignTransactionInput & {
  commitment?: 'confirmed' | 'finalized' | 'processed'
  rpcClient?: {
    rpc: unknown
    rpcSubscriptions: unknown
  }
  sendAndConfirmTransaction?: (
    transaction: Awaited<ReturnType<typeof buildAndSignTransaction>>,
    config?: { commitment?: 'confirmed' | 'finalized' | 'processed' },
  ) => Promise<void>
}

function withRemainingAccounts<TInstruction extends { accounts: readonly AccountMeta[] }>(
  instruction: TInstruction,
  remainingAccounts?: readonly AccountMeta[],
): TInstruction {
  if (!remainingAccounts?.length) return instruction
  return Object.freeze({
    ...instruction,
    accounts: [...instruction.accounts, ...remainingAccounts],
  }) as TInstruction
}

export async function deriveAccountCompressionAuthority(programAddress: Address): Promise<Address> {
  const [authority] = await getProgramDerivedAddress({
    programAddress,
    seeds: [CPI_AUTHORITY_SEED],
  })
  return authority
}

function normalizeBlockhashLifetimeConstraint(
  response: BlockhashLifetimeConstraint | { value: BlockhashLifetimeConstraint },
): BlockhashLifetimeConstraint {
  return 'value' in response ? response.value : response
}

export async function buildAndSignTransaction({
  feePayer,
  instructions,
  latestBlockhash,
  rpc,
  version = 0,
}: BuildAndSignTransactionInput) {
  const resolvedLatestBlockhash =
    latestBlockhash ?? (rpc ? normalizeBlockhashLifetimeConstraint(await rpc.getLatestBlockhash().send()) : undefined)
  if (!resolvedLatestBlockhash) {
    throw new Error('latestBlockhash is required when rpc is not provided.')
  }

  const messageWithInstructions = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      // @ts-expect-error resolvedLatestBlockhash type issue
      resolvedLatestBlockhash,
      setTransactionMessageFeePayerSigner(feePayer, createTransactionMessage({ version })),
    ),
  )

  return signTransactionMessageWithSigners(messageWithInstructions)
}

export async function sendAndConfirmInstructions({
  commitment = 'confirmed',
  rpcClient,
  sendAndConfirmTransaction,
  ...buildInput
}: SendAndConfirmInstructionsInput) {
  const signedTransaction = await buildAndSignTransaction({
    ...buildInput,
    rpc: buildInput.rpc ?? (rpcClient?.rpc as GetLatestBlockhashApi | undefined),
  })

  const sendAndConfirm =
    sendAndConfirmTransaction ??
    (rpcClient
      ? sendAndConfirmTransactionFactory({
          rpc: rpcClient.rpc as Parameters<typeof sendAndConfirmTransactionFactory>[0]['rpc'],
          rpcSubscriptions: rpcClient.rpcSubscriptions as Parameters<
            typeof sendAndConfirmTransactionFactory
          >[0]['rpcSubscriptions'],
        })
      : undefined)
  if (!sendAndConfirm) {
    throw new Error('sendAndConfirmTransaction or rpcClient is required.')
  }
  assertIsTransactionWithBlockhashLifetime(signedTransaction)
  await sendAndConfirm(signedTransaction, { commitment })
  return getSignatureFromTransaction(signedTransaction)
}

async function resolveCommonAccounts(
  programAddress: Address,
  inputDefaults: LightSystemProgramCommonAccounts | undefined,
  inputOverrides: LightSystemProgramCommonAccounts,
) {
  return {
    accountCompressionAuthority:
      inputOverrides.accountCompressionAuthority ??
      inputDefaults?.accountCompressionAuthority ??
      (await deriveAccountCompressionAuthority(programAddress)),
    accountCompressionProgram:
      inputOverrides.accountCompressionProgram ??
      inputDefaults?.accountCompressionProgram ??
      DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS,
    noopProgram: inputOverrides.noopProgram ?? inputDefaults?.noopProgram ?? DEFAULT_NOOP_PROGRAM_ADDRESS,
    registeredProgramPda:
      inputOverrides.registeredProgramPda ??
      inputDefaults?.registeredProgramPda ??
      DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS,
  }
}

export class SystemAccountMetaConfig {
  readonly cpiContext?: Address
  readonly selfProgram: Address
  readonly solCompressionRecipient?: Address
  readonly solPoolPda?: Address

  private constructor(input: SystemAccountMetaConfigInput) {
    this.cpiContext = input.cpiContext
    this.selfProgram = input.selfProgram
    this.solCompressionRecipient = input.solCompressionRecipient
    this.solPoolPda = input.solPoolPda
  }

  static new(selfProgram: Address): SystemAccountMetaConfig {
    return new SystemAccountMetaConfig({ selfProgram })
  }

  static newWithCpiContext(selfProgram: Address, cpiContext: Address): SystemAccountMetaConfig {
    return new SystemAccountMetaConfig({ cpiContext, selfProgram })
  }
}

export async function getLightSystemAccountMetasV2(
  config: SystemAccountMetaConfig,
  {
    accountCompressionAuthority,
    accountCompressionProgram = DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS,
    lightSystemProgram,
    registeredProgramPda = DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS,
  }: {
    accountCompressionAuthority?: Address
    accountCompressionProgram?: Address
    lightSystemProgram: Address
    registeredProgramPda?: Address
  },
): Promise<AccountMeta[]> {
  const [cpiSigner] = await getProgramDerivedAddress({
    programAddress: config.selfProgram,
    seeds: [CPI_AUTHORITY_SEED],
  })

  const resolvedAccountCompressionAuthority =
    accountCompressionAuthority ?? (await deriveAccountCompressionAuthority(lightSystemProgram))

  const metas: AccountMeta[] = [
    { address: lightSystemProgram, role: AccountRole.READONLY },
    { address: cpiSigner, role: AccountRole.READONLY },
    { address: registeredProgramPda, role: AccountRole.READONLY },
    { address: resolvedAccountCompressionAuthority, role: AccountRole.READONLY },
    { address: accountCompressionProgram, role: AccountRole.READONLY },
    { address: DEFAULT_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
  ]

  if (config.solPoolPda) {
    metas.push({ address: config.solPoolPda, role: AccountRole.WRITABLE })
  }
  if (config.solCompressionRecipient) {
    metas.push({ address: config.solCompressionRecipient, role: AccountRole.WRITABLE })
  }
  if (config.cpiContext) {
    metas.push({ address: config.cpiContext, role: AccountRole.WRITABLE })
  }

  return metas
}

export class PackedAccounts {
  private readonly map = new Map<Address, PackedMeta>()
  private nextIndex = 0
  private readonly preAccounts: AccountMeta[] = []
  private readonly systemAccounts: AccountMeta[] = []

  static async newWithSystemAccountsV2(
    config: SystemAccountMetaConfig,
    lightSystemConfig: {
      accountCompressionAuthority?: Address
      accountCompressionProgram?: Address
      lightSystemProgram: Address
      registeredProgramPda?: Address
    },
  ): Promise<PackedAccounts> {
    const instance = new PackedAccounts()
    await instance.addSystemAccountsV2(config, lightSystemConfig)
    return instance
  }

  addPreAccountsMeta(accountMeta: AccountMeta) {
    this.preAccounts.push(accountMeta)
  }

  addPreAccountsSigner(address: Address) {
    this.preAccounts.push({ address, role: AccountRole.READONLY_SIGNER })
  }

  addPreAccountsSignerMut(address: Address) {
    this.preAccounts.push({ address, role: AccountRole.WRITABLE_SIGNER })
  }

  async addSystemAccountsV2(
    config: SystemAccountMetaConfig,
    lightSystemConfig: {
      accountCompressionAuthority?: Address
      accountCompressionProgram?: Address
      lightSystemProgram: Address
      registeredProgramPda?: Address
    },
  ) {
    this.systemAccounts.push(...(await getLightSystemAccountMetasV2(config, lightSystemConfig)))
  }

  insertOrGet(address: Address): number {
    return this.insertOrGetConfig(address, false, true)
  }

  insertOrGetReadOnly(address: Address): number {
    return this.insertOrGetConfig(address, false, false)
  }

  insertOrGetConfig(address: Address, isSigner: boolean, isWritable: boolean): number {
    const existing = this.map.get(address)
    if (existing) return existing[0]

    const index = this.nextIndex
    this.nextIndex += 1
    const role = isSigner
      ? isWritable
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.READONLY_SIGNER
      : isWritable
        ? AccountRole.WRITABLE
        : AccountRole.READONLY
    this.map.set(address, [index, { address, role }])
    return index
  }

  toAccountMetas(): {
    packedStart: number
    remainingAccounts: AccountMeta[]
    systemStart: number
  } {
    const packed = [...this.map.values()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])
    const systemStart = this.preAccounts.length
    const packedStart = systemStart + this.systemAccounts.length

    return {
      packedStart,
      remainingAccounts: [...this.preAccounts, ...this.systemAccounts, ...packed],
      systemStart,
    }
  }
}

export function createLightSystemProgramSdk({ defaults, programAddress }: CreateLightSystemProgramSdkInput) {
  return {
    buildInitCpiContextAccountInstruction(input: InitCpiContextAccountInput) {
      return getInitCpiContextAccountInstruction(input, { programAddress })
    },

    async buildInvokeCpiInstruction(input: BuildInvokeCpiInstructionInput) {
      const commonAccounts = await resolveCommonAccounts(programAddress, defaults, input)
      const instruction = getInvokeCpiInstruction(
        {
          ...input,
          ...commonAccounts,
          systemProgram: input.systemProgram ?? DEFAULT_SYSTEM_PROGRAM_ADDRESS,
        },
        { programAddress },
      )
      return withRemainingAccounts(instruction, input.remainingAccounts)
    },

    async buildInvokeCpiWithReadOnlyInstruction(input: BuildInvokeCpiWithReadOnlyInstructionInput) {
      const commonAccounts = await resolveCommonAccounts(programAddress, defaults, input)
      const instruction = getInvokeCpiWithReadOnlyInstruction(
        {
          ...input,
          ...commonAccounts,
          systemProgram: input.systemProgram ?? DEFAULT_SYSTEM_PROGRAM_ADDRESS,
        },
        { programAddress },
      )
      return withRemainingAccounts(instruction, input.remainingAccounts)
    },

    async buildInvokeInstruction(input: BuildInvokeInstructionInput) {
      const commonAccounts = await resolveCommonAccounts(programAddress, defaults, input)
      const instruction = getInvokeInstruction(
        {
          ...input,
          ...commonAccounts,
          systemProgram: input.systemProgram ?? DEFAULT_SYSTEM_PROGRAM_ADDRESS,
        },
        { programAddress },
      )
      return withRemainingAccounts(instruction, input.remainingAccounts)
    },

    defaults: {
      accountCompressionProgram: defaults?.accountCompressionProgram ?? DEFAULT_ACCOUNT_COMPRESSION_PROGRAM_ADDRESS,
      noopProgram: defaults?.noopProgram ?? DEFAULT_NOOP_PROGRAM_ADDRESS,
      registeredProgramPda: defaults?.registeredProgramPda ?? DEFAULT_REGISTERED_PROGRAM_PDA_ADDRESS,
    },
    programAddress,
  }
}
