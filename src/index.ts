
import SpecTransport from "@ledgerhq/hw-transport-node-speculos";
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

import StxApp from "@zondax/ledger-blockstack";
import { LedgerError } from "@zondax/ledger-blockstack";

import * as btc from "bitcoinjs-lib";
import * as C32 from "c32check";
import { AddressVersion, TransactionAuthField, UnsignedMultiSigTokenTransferOptions } from "@stacks/transactions";
import readline from "readline";

import BigNum from "bn.js";

import * as StxTx from "@stacks/transactions";

import { updateMultisigData, MultisigData, makeMultiSigAddr, decodeMultisigData, encodeMultisigData, ledgerSignMultisigTx, finalizeMultisigTransaction, getPubKey, getPubKeyMultisigStandardIndex, getPubKeySingleSigStandardIndex } from "./lib";

function setMultisigTransactionSpendingConditionFields(tx: StxTx.StacksTransaction, fields: TransactionAuthField[]) {
  if (!tx.auth.spendingCondition) {
    throw new Error(`Multisig transaction cannot be finalized: did not have enough information in multisig data to initialize spending condition`);
  }
  if (StxTx.isSingleSig(tx.auth.spendingCondition)) {
    throw new Error(`Multisig transaction cannot be finalized: supplied information initialized a singlesig transaction`);
  }
  tx.auth.spendingCondition.fields = fields;
}

async function ledgerSignTx(app: StxApp, path: string, partialFields: TransactionAuthField[], unsignedTx: Buffer, prevSigHash?: string) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');

  const outFields = partialFields.slice();
  const pubkeys = partialFields
        .map((x) => {
          console.log(x);
          if (x.contents.type === StxTx.StacksMessageType.PublicKey) {
            return x.contents.data.toString('hex')
          } else {
            return null
          }
        });

  if (pubkeys.indexOf(pubkey) < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx fields: ${partialFields}`);
  }

  const index = pubkeys.indexOf(pubkey);

  let resp;
  if (prevSigHash) {
    let txBuffer = unsignedTx.slice();
    let postSigHashBuffer = Buffer.from(prevSigHash, 'hex');
    let pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    let prev_signer_field = partialFields[index - 1];
    if (prev_signer_field.contents.type !== StxTx.StacksMessageType.MessageSignature) {
      throw new Error(`Previous sighash was supplied, but previous signer was not included in the transaction's auth fields`);
    }
    let prev_signer = Buffer.from(prev_signer_field.contents.data, 'hex');
    let msg_array = [txBuffer, postSigHashBuffer, pkEnc, prev_signer];
    resp = await app.sign(path, Buffer.concat(msg_array));
  } else {
    resp = await app.sign(path, unsignedTx.slice());
  }

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
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

async function generateMultiSignedTx() {
  let privkeys = [
    'dd7229314db5d50122cd8d4ff8975f57317f54c946cd233d8d35f5b616fe961e01',
    '119a851bd1201b93e6477a0a9c7d29515735530df92ab265166ca3da119f803501',
    '22d45b79bda06915c5d1a98da577089763b6c660304d3919e50797352dc6722f01',
  ]

  const privKeys = privkeys.map(StxTx.createStacksPrivateKey);

  let pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  let transaction = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  let signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction
}


async function generateMultiUnsignedTx(app: StxApp) {
  const pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  let partialFields =
    pubkeys.map((x) => {
      return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, StxTx.createStacksPublicKey(x))
    });

  return { unsignedTx, pubkeys: partialFields }
}

function checkAddressPubKeyMatch(pubkeys: string[], required: number, address: string) {
  // first try in sorted order
  let authorizedPKs = pubkeys.slice().sort().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  let c32Addr1 = C32.b58ToC32(btcAddr);
  if (c32Addr1 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  // try in order given
  authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  let c32Addr2 = C32.b58ToC32(btcAddr);
  if (c32Addr2 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  throw `Public keys did not match expected address. Expected ${address}, but pubkeys correspond to ${c32Addr1} or ${c32Addr2}`
}

async function generateMultiSigAddr(app: StxApp) {
  let pk0 = await getPubKeyMultisigStandardIndex(app, 0);
  let pk1 = await getPubKeyMultisigStandardIndex(app, 1);
  let pk2 = await getPubKeyMultisigStandardIndex(app, 2);

  return makeMultiSigAddr([pk0, pk1, pk2].sort(), 2);
}

async function readInput(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer: string = await new Promise(resolve => {
    rl.question(`${query}? `, answer => resolve(answer))
  });

  rl.close();

  return answer;
}

async function main(args: string[]) {
  if (args[0] == "create_transfer") {
    let fromAddress = (await readInput("From Address (C32)")).trim();
    let publicKeys = (await readInput("From public keys (comma separate)"))
        .trim().split(',').map(x => x.trim());
    let requiredSigners = parseInt(await readInput("Required signers (number)"));
    let toAddress = (await readInput("Required signers (number)")).trim();
    let toSend = new BigNum((await readInput("microSTX to send")).trim(), 10);
    let fee = new BigNum((await readInput("microSTX fee")).trim(), 10);

    let memo = await readInput("Memo");

    publicKeys = checkAddressPubKeyMatch(publicKeys, requiredSigners, fromAddress);

    console.log(`Creating unsigned transfer with ${fromAddress} using ${publicKeys}/${requiredSigners}`);
    return
  }

//  let transport = await SpecTransport.open({ apduPort: 40000 });
    let transport = await TransportNodeHid.create();

  if (args[0] == "get_pub") {
    let app = new StxApp(transport);
    const path = args[1];
    if (!path) {
      throw new Error("Must supply path as second argument");
    }
    let pubkey = await getPubKey(app, path);
    console.log(`Pub: ${pubkey} @  ${path}`);
  } else if (args[0] == "make_multi") {
    let app = new StxApp(transport);
    let addr = await generateMultiSigAddr(app);
    console.log(`Addr: ${addr}`);
  }

  await transport.close();
}

var inputs = process.argv.slice(2);

main(inputs)
  .then(x => { console.log("") })
