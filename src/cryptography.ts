import { ethers } from 'ethers'
import type { AnyObject } from './types'
import { redis } from './redisClient'

const VALIDATOR_1271_ABI = ['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']

export function getEvmEIP712Types(chainId: number) {
  if ([42161, 421613].includes(chainId)) {
    return {
      Order: [
        { name: 'user', type: 'address' },
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'expirationTimeSeconds', type: 'uint256' },
      ],
    }
  }
  return null
}

export function modifyOldSignature(signature: string): string {
  if (signature.slice(-2) === '00') return signature.slice(0, -2).concat('1B')
  if (signature.slice(-2) === '01') return signature.slice(0, -2).concat('1C')
  return signature
}

// Address recovery wrapper
function recoverAddress(hash: string, signature: string): string {
  try {
    return ethers.utils.recoverAddress(hash, signature)
  } catch {
    return ''
  }
}

// Comparing addresses. targetAddr is already checked upstream
function addrMatching(recoveredAddr: string, targetAddr: string) {
  if (recoveredAddr === '') return false
  if (!ethers.utils.isAddress(recoveredAddr)) throw new Error(`Invalid recovered address: ${recoveredAddr}`)

  return recoveredAddr.toLowerCase() === targetAddr.toLowerCase()
}

/*
// EIP 1271 check
async function eip1271Check(
  provider: ethers.providers.Provider,
  signer: string,
  hash: string,
  signature: string
) {
  let ethersProvider
  if (ethers.providers.Provider.isProvider(provider)) {
    ethersProvider = provider
  } else {
    ethersProvider = new ethers.providers.Web3Provider(provider)
  }
  const code = await ethersProvider.getCode(signer)
  if (code && code !== '0x') {
    const contract = new ethers.Contract(
      signer,
      VALIDATOR_1271_ABI,
      ethersProvider
    )
    return (await contract.isValidSignature(hash, signature)) === '0x1626ba7e'
  }
  return false
}
*/

// you only need to pass one of: typedData or message
export async function verifyMessage(param: {
  signer: string
  message?: string
  typedData?: AnyObject
  signature: string
}): Promise<boolean> {
  const { message, typedData, signer } = param
  const signature = modifyOldSignature(param.signature)
  let finalDigest: string

  if (message) {
    finalDigest = ethers.utils.hashMessage(message)
  } else if (typedData) {
    if (!typedData.domain || !typedData.types || !typedData.message) {
      throw Error('Missing one or more properties for typedData (domain, types, message)')
    }

    // eslint-disable-next-line no-underscore-dangle
    finalDigest = ethers.utils._TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message)
  } else {
    throw Error('Missing one of the properties: message or typedData')
  }

  // 1nd try: elliptic curve signature (EOA)
  const recoveredAddress = recoverAddress(finalDigest, signature)
  if (addrMatching(recoveredAddress, signer)) return true

  // 2nd try: Check registered vault address
  // Requires manual whitelist
  const vaultSigner = await redis.get(`vaultsigner:${signer.toLowerCase()}`)
  if (vaultSigner && addrMatching(recoveredAddress, vaultSigner)) return true
  console.log(`Expected ${signer}, recovered ${recoveredAddress}`)

  return false
}
