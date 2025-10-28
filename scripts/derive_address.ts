import { deriveSecp256k1PublicKey } from '@dfinity/ic-pub-key';
import { ethers } from 'ethers';

async function main() {
  const masterPubKey = process.env.IC_MASTER_PUBKEY;
  const chainCode = process.env.IC_CHAIN_CODE;
  const derivationPath = process.env.IC_DERIVATION_PATH || '';

  if (!masterPubKey || !chainCode) {
    throw new Error('IC_MASTER_PUBKEY and IC_CHAIN_CODE env vars required');
  }

  const derived = deriveSecp256k1PublicKey({
    masterPublicKey: masterPubKey,
    chainCode,
    path: derivationPath,
  });

  const uncompressed = derived.uncompressedPublicKeyHex.substring(2);
  const hash = ethers.utils.keccak256('0x' + uncompressed);
  const address = '0x' + hash.slice(-40);

  console.log('Derived compressed pubkey:', derived.compressedPublicKeyHex);
  console.log('Derived Ethereum address:', address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
