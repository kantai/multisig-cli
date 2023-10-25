
//import SpecTransport from "@ledgerhq/hw-transport-node-speculos";
//import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

import StxApp from "@zondax/ledger-blockstack";
import { LedgerError } from "@zondax/ledger-blockstack";
import Papa from 'papaparse';

import * as btc from "bitcoinjs-lib";
import * as C32 from "c32check";
import { createTransactionAuthField, TransactionAuthField, StacksTransaction } from "@stacks/transactions";
import * as StxTx from "@stacks/transactions";
import { StacksNetworkName } from "@stacks/network";
import * as fs from 'node:fs/promises';

// This will generate pubkeys using
//  the format: m/44'/5757'/0'/0/x
const XPUB_PATH = `m/44'/5757'/0'`;

// This will generate pubkeys using
//  the format: m/5757'/0'/0/0/x
const BTC_MULTISIG_SCRIPT_PATH = `m/5757'/0'/0`;

export interface MultisigTxInput {
  sender?: string  // Optional. Can be used to check address generation from pubkeys
  recipient: string
  fee: string
  amount: string
  publicKeys: string[]
  numSignatures: number
  nonce?: string
  network?: string
  memo?: string
}

// Export `StacksTransaction` as base64-encoded string
export function txEncode(tx: StacksTransaction): string {
  return tx.serialize().toString('base64');
}

// Import `StacksTransaction` from base64-encoded string
export function txDecode(b64: string): StacksTransaction {
  return StxTx.deserializeTransaction(Buffer.from(b64, 'base64'));
}

// Export an object as base64-encoded string
export function b64Encode(data: object): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

// Import an object from base64-encoded string
export function b64Decode(serialized: string): object {
  return JSON.parse(Buffer.from(serialized, 'base64').toString());
}

// TODO: I don't know if something like this is already in Stacks.js (I couldn't find it), but it should be
export function parseNetworkName(input: string | undefined): StacksNetworkName | undefined {
  const allowedNames: StacksNetworkName[] = ['mainnet', 'testnet'];
  for (const n of allowedNames) {
    if (input?.toLowerCase().includes(n)) {
      return n;
    }
  }
  return undefined;
}

export async function getPubKey(app: StxApp, path: string): Promise<string> {
  const amt = await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig);
  return amt.publicKey.toString('hex');
}

export async function getPubKeySingleSigStandardIndex(app: StxApp, index: number): Promise<string> {
  const path = `${XPUB_PATH}/0/${index}`;
  return getPubKey(app, path);
}

export async function getPubKeyMultisigStandardIndex(app: StxApp, index: number): Promise<{ pubkey: string, path: string }> {
  const path = `${BTC_MULTISIG_SCRIPT_PATH}/0/${index}`;
  return { pubkey: await getPubKey(app, path), path };
}

export async function generateMultiSigAddr(app: StxApp) {
  const pk0 = await getPubKeyMultisigStandardIndex(app, 0);
  const pk1 = await getPubKeyMultisigStandardIndex(app, 1);
  const pk2 = await getPubKeyMultisigStandardIndex(app, 2);

  const pubkeys = [pk0, pk1, pk2].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
  console.log(`Making a 2 - of - ${pubkeys.length} multisig address...`);
  console.log(`Pubkeys: ${pubkeys[0].pubkey}, ${pubkeys[1].pubkey}, ${pubkeys[2].pubkey}`);
  console.log(`Paths: ${pubkeys[0].path}, ${pubkeys[1].path}, ${pubkeys[2].path}`);
  return makeMultiSigAddr([pubkeys[0].pubkey, pubkeys[1].pubkey, pubkeys[2].pubkey], 2);
}

export function makeMultiSigAddr(pubkeys: string[], required: number): string {
  const authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  const redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  const btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr = C32.b58ToC32(btcAddr);
  return c32Addr;
}

// Check that pubkeys match sender address and return in correct order
export function checkAddressPubKeyMatch(pubkeys: string[], required: number, address: string): string[] {
  // first try in sorted order
  let authorizedPKs = pubkeys.slice().sort().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr1 = C32.b58ToC32(btcAddr);
  if (c32Addr1 === address) {
    return authorizedPKs.map((k) => k.toString('hex'));
  }

  // try in order given
  authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr2 = C32.b58ToC32(btcAddr);
  if (c32Addr2 === address) {
    return authorizedPKs.map((k) => k.toString('hex'));
  }

  throw `Public keys did not match expected address. Expected ${address}, but pubkeys correspond to ${c32Addr1} or ${c32Addr2}`;
}

/// Builds spending condition fields out of an array of public key hex strings
function makeSpendingConditionFields(keys: string[]): TransactionAuthField[] {
  return keys
    .map(StxTx.createStacksPublicKey)
    .map(key => StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, key));
}

function setMultisigTransactionSpendingConditionFields(tx: StacksTransaction, fields: TransactionAuthField[]) {
  if (!tx.auth.spendingCondition) {
    throw new Error(`Multisig transaction cannot be finalized: did not have enough information in multisig data to initialize spending condition`);
  }
  if (StxTx.isSingleSig(tx.auth.spendingCondition)) {
    throw new Error(`Multisig transaction cannot be finalized: supplied information initialized a singlesig transaction`);
  }
  tx.auth.spendingCondition.fields = fields;
}

// Create transactions from file path
export async function makeKeyPathMapFromCSVFile(file: string): Promise<Map<string, string>> {
  const data = await fs.readFile(file, { encoding: 'utf8' });
  return makeKeyPathMapFromCSVText(data);
}

// Create transactions from raw string data (must be JSON array of `MultisigTxInput`)
export function makeKeyPathMapFromCSVText(text: string): Map<string, string> {
  const { data, errors } = Papa.parse(text, { header: true });

  if (errors) {
    console.dir(errors, {depth: null, colors: true});
    throw Error('Errors parsing CSV data');
  }

  if (!Array.isArray(data)) {
    throw Error('Data is not an array');
  }

  const keyPaths = new Map<string, string>();
  for (const line of data) {
    keyPaths.set(line?.key, line?.path);
  }
  return keyPaths;
}

// Create transactions from file path
export async function makeTxInputsFromCSVFile(file: string): Promise<MultisigTxInput[]> {
  const data = await fs.readFile(file, { encoding: 'utf8' });
  return makeTxInputsFromCSVText(data);
}

// Create transactions from raw string data (must be JSON array of `MultisigTxInput`)
export function makeTxInputsFromCSVText(text: string): MultisigTxInput[] {
  const { data, errors } = Papa.parse(text, { header: true });

  if (errors) {
    console.dir(errors, {depth: null, colors: true});
    throw Error('Errors parsing CSV data');
  }

  if (!Array.isArray(data)) {
    throw Error('Data is not array');
  }

  // Everything is parsed as strings. Need to fix up types here
  data.forEach((line: any) => {
    line['numSignatures'] = parseInt(line['numSignatures']);
  });
  return validateTxInputs(data as MultisigTxInput[]);
}

// Create transactions from file path
export async function makeTxInputsFromFile(file: string): Promise<MultisigTxInput[]> {
  const data = await fs.readFile(file, { encoding: 'utf8' });
  return makeTxInputsFromText(data);
}

// Create transactions from raw string data (must be JSON array of `MultisigTxInput`)
export function makeTxInputsFromText(text: string): MultisigTxInput[] {
  const data = JSON.parse(text);
  return validateTxInputs(data);
}

export function validateTxInputs(data: object[]): MultisigTxInput[] {
  const errorPrefix = 'Transaction input validation failed';
  const inputs = data as MultisigTxInput[];

  if (!Array.isArray(data)) {
    throw Error(`${errorPrefix}: Data is not an array`);
  }
  for (const i in inputs) {
    const input = inputs[i];
    const t = typeof input;
    if (t !== 'object') {
      throw Error(`${errorPrefix}: Element at index ${i} is of type '${t}'`);
    }
    if (typeof input.recipient !== 'string') {
      throw Error(`${errorPrefix}: Property 'recipient' of element ${i} not valid: ${input.recipient}'`);
    }
    if (typeof input.fee !== 'string') {
      throw Error(`${errorPrefix}: Property 'fee' of element ${i} not valid: ${input.fee}'`);
    }
    if (typeof input.amount !== 'string') {
      throw Error(`${errorPrefix}: Property 'amount' of element ${i} not valid: ${input.amount}'`);
    }
    if (!Array.isArray(input.publicKeys)) {
      throw Error(`${errorPrefix}: Property 'publicKeys' of element ${i} not valid: ${input.publicKeys}'`);
    }
    for (const e of input.publicKeys) {
      if (typeof e !== 'string') {
        throw Error(`${errorPrefix}: Property 'publicKeys' of element ${i} contains invalid element: ${e}'`);
      }
    }
    if (typeof input.numSignatures !== 'number') {
      throw Error(`${errorPrefix}: Property 'numSignatures' of element ${i} not valid: ${input.numSignatures}'`);
    }
  }

  return data as MultisigTxInput[];
}

// Create transactions from `MultisigTxInput[]`
export async function makeStxTokenTransfers(inputs: MultisigTxInput[]): Promise<StacksTransaction[]> {
  // Use Promise.all to process inputs in parallel
  return await Promise.all(inputs.map(makeStxTokenTransfer));
}

/// Builds an unsigned transfer out of a multisig data serialization
export async function makeStxTokenTransfer(input: MultisigTxInput): Promise<StacksTransaction> {
  let { publicKeys } = input;
  const { sender, recipient, numSignatures, memo } = input;
  const fee = BigInt(input.fee);
  const amount = BigInt(input.amount);
  const anchorMode = StxTx.AnchorMode.Any;

  // Validate sender address if present
  // This may re-order publicKeys to match address
  if (sender) {
    publicKeys = checkAddressPubKeyMatch(publicKeys, numSignatures, sender);
  }

  const options: StxTx.UnsignedMultiSigTokenTransferOptions = { anchorMode, fee, amount, numSignatures, publicKeys, recipient, memo };

  // Conditional fields
  if (input.nonce) {
    options.nonce = BigInt(input.nonce);
  }

  const network = parseNetworkName(input.network);
  if (network) {
    options.network = network;
  }

  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer(options);

  // Set public keys in auth fields
  // TODO: Is this necessary to set auth fields or already done by `makeUnsignedSTXTokenTransfer()`
  const authFields = makeSpendingConditionFields(publicKeys);
  setMultisigTransactionSpendingConditionFields(unsignedTx, authFields);

  return unsignedTx;
}

export interface AuthFieldInfo {
  authFields: number,
  pubkeys: string[],
  signatures: number,
  signaturesRequired: number,
}

export function getAuthFieldInfo(tx: StacksTransaction): AuthFieldInfo {
  let authFields = 0;
  let signatures = 0;
  const pubkeys: string[] = [];

  const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;
  spendingCondition.fields.forEach(f => {
    authFields += 1;
    const type = f.contents.type;
    switch (type) {
    case StxTx.StacksMessageType.PublicKey:
      pubkeys.push(f.contents.data.toString('hex'));
      break;
    case StxTx.StacksMessageType.MessageSignature:
      signatures += 1;
      break;
    default:
      console.error(`Unknown auth field type: ${type}`);
    }
  });

  return {
    authFields,
    pubkeys,
    signatures,
    signaturesRequired: spendingCondition.signaturesRequired,
  };
}

// Get signers after given pubkey that have signed transaction
export function getSignersAfter(pubkey: string, authFields: TransactionAuthField[]): number[] | null {
  // Find index of pubkey in auth fields
  const pkIndex = authFields
    .findIndex(f => f.contents.type === StxTx.StacksMessageType.PublicKey && f.contents.data.toString('hex') === pubkey);

  // pubkey isn't in signer set or has already signed
  if (pkIndex < 0) {
    return null;
  }

  // Find all signatures after pubkey
  return authFields
    .map((field, index) => ({ field, index })) // Keep track of index for each authField
    .slice(pkIndex + 1) // Ignore field with pubkey and those before it
    .filter(e => e.field.contents.type === StxTx.StacksMessageType.MessageSignature)
    .map(e => e.index);
}

// Create transactions from file path
export async function encodedTxsFromFile(file: string): Promise<string[]> {
  const data = await fs.readFile(file, { encoding: 'utf8' });
  return encodedTxsFromText(data);
}

// Create transactions from raw string data (must be JSON array of `MultisigTxInput`)
export function encodedTxsFromText(str: string): string[] {
  const errorPrefix = 'Expected array of base64-encoded strings';
  const txsEncoded = JSON.parse(str);

  // Do some basic type checking
  if (!Array.isArray(txsEncoded)) {
    throw Error(`${errorPrefix}: Data is not an array`);
  }
  for (const i in txsEncoded) {
    const tx = txsEncoded[i];
    const t = typeof tx;
    if (t !== 'string') {
      throw Error(`${errorPrefix}: Found '${t}' at index ${i}`);
    }
  }

  return txsEncoded as string[];
}

export async function ledgerSignMultisigTx(app: StxApp, path: string, tx: StacksTransaction): Promise<StacksTransaction> {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
    .publicKey.toString('hex');

  // Check transaction is correct type
  const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;
  if (StxTx.isSingleSig(spendingCondition)) {
    throw new Error(`Tx has single signature spending condition`);
  }

  const authFields = spendingCondition.fields;
  if (!authFields) {
    throw new Error(`Tx has no auth fields, not a valid multisig transaction`);
  }

  // Match pubkey in auth fields
  const pubkeys = authFields.map(f => {
    if (f.contents.type === StxTx.StacksMessageType.PublicKey) {
      return f.contents.data.toString('hex');
    } else {
      return null;
    }
  });
  const index = pubkeys.indexOf(pubkey);

  if (index < 0) {
    throw new Error(`Pubkey ${pubkey} not found in spending auth fields: ${pubkeys}`);
  }

  // Signing must be done in order of pubkey appearance in authFields
  // We can't proceed if order is wrong
  const signersAfter = getSignersAfter(pubkey, authFields);
  if (!signersAfter) {
    throw new Error(`Pubkey in auth fields but not found by getSignersAfter(): ${pubkey}`);
  } else if (signersAfter.length) {
    throw new Error(`Invalid signing order! The following signers have already signed: ${signersAfter}`);
  }

  const signingBuffer = tx.serialize();
  const resp = await app.sign(path, signingBuffer);

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp);
    throw new Error('Ledger responded with errors');
  }

  const signature = StxTx.createMessageSignature(resp.signatureVRS.toString('hex'));
  authFields[index] = createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, signature);

  return tx;
}

export async function ledgerSignTx(app: StxApp, path: string, partialFields: TransactionAuthField[], unsignedTx: Buffer, prevSigHash?: string) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
    .publicKey.toString('hex');

  const outFields = partialFields.slice();
  const pubkeys = partialFields
    .map((x) => {
      console.log(x);
      if (x.contents.type === StxTx.StacksMessageType.PublicKey) {
        return x.contents.data.toString('hex');
      } else {
        return null;
      }
    });

  if (pubkeys.indexOf(pubkey) < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx fields: ${partialFields}`);
  }

  const index = pubkeys.indexOf(pubkey);

  let resp;
  if (prevSigHash) {
    const txBuffer = unsignedTx.slice();
    const postSigHashBuffer = Buffer.from(prevSigHash, 'hex');
    const pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    const prev_signer_field = partialFields[index - 1];
    if (prev_signer_field.contents.type !== StxTx.StacksMessageType.MessageSignature) {
      throw new Error(`Previous sighash was supplied, but previous signer was not included in the transaction's auth fields`);
    }
    const prev_signer = Buffer.from(prev_signer_field.contents.data, 'hex');
    const msg_array = [txBuffer, postSigHashBuffer, pkEnc, prev_signer];
    resp = await app.sign(path, Buffer.concat(msg_array));
  } else {
    resp = await app.sign(path, unsignedTx.slice());
  }

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp);
    throw new Error('Ledger responded with errors');
  }

  const next_sighash = resp.postSignHash.toString("hex");

  console.log(next_sighash);

  outFields[index] = StxTx.createTransactionAuthField(
    StxTx.PubKeyEncoding.Compressed,
    StxTx.createMessageSignature(
      resp.signatureVRS.toString('hex')
    ));
  return { outFields, next_sighash };
}

export async function generateMultiSignedTx(): Promise<StacksTransaction> {
  const privkeys = [
    'dd7229314db5d50122cd8d4ff8975f57317f54c946cd233d8d35f5b616fe961e01',
    '119a851bd1201b93e6477a0a9c7d29515735530df92ab265166ca3da119f803501',
    '22d45b79bda06915c5d1a98da577089763b6c660304d3919e50797352dc6722f01',
  ];

  //const privKeys = privkeys.map(StxTx.createStacksPrivateKey);

  const pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  //console.log(pubkeys);
  //console.log(makeMultiSigAddr(pubkeys, 2));

  const transaction = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: BigInt(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: BigInt(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  const signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction;
}

export async function generateMultiUnsignedTx() {
  const pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: BigInt(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: BigInt(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  const partialFields =
    pubkeys.map((x) => {
      return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, StxTx.createStacksPublicKey(x));
    });

  return { unsignedTx, pubkeys: partialFields };
}
