
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

import { MultisigData, makeMultiSigAddr, makeStxTokenTransferFrom, base64_deserialize, base64_serialize, ledgerSignMultisigTx, getPubKey, getPubKeyMultisigStandardIndex, getPubKeySingleSigStandardIndex } from "./lib";

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

  let pubkeys = [pk0, pk1, pk2].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
  console.log(`Making a 2 - of - ${pubkeys.length} multisig address...`);
  console.log(`Pubkeys: ${pubkeys[0].pubkey}, ${pubkeys[1].pubkey}, ${pubkeys[2].pubkey}`);
  console.log(`Paths: ${pubkeys[0].path}, ${pubkeys[1].path}, ${pubkeys[2].path}`);
  return makeMultiSigAddr([pubkeys[0].pubkey, pubkeys[1].pubkey, pubkeys[2].pubkey], 2);
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

  return answer.trim();
}

async function main(args: string[]) {
  //let transport = await SpecTransport.open({ apduPort: 40000 });
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
  } else if (args[0] == "create_tx") {
    const fromAddr = (await readInput("From Address (C32)"));
    const fromPKsHex = (await readInput("From public keys (comma separate)")).split(',').map(x => x.trim()).sort();
    const requiredSigners = parseInt(await readInput("Required signers (number)"));
    const toAddress = await readInput("To Address (C32)");
    const toSend = await readInput("microSTX to send");
    const fee = await readInput("microSTX fee");

    const spendingFields = fromPKsHex.map(x => ({ publicKey: x }));
    const generatedMultiSigAddress = makeMultiSigAddr(fromPKsHex, requiredSigners);

    if (generatedMultiSigAddress !== fromAddr) {
        const message = `Public keys, required signers do not match expected address: expected=${fromAddr}, generated=${generatedMultiSigAddress}`;
        throw new Error(message);
    }

    // Contains tx + metadata
    const multisigData: MultisigData = {
        tx: {
            fee,
            amount: toSend,
            numSignatures: requiredSigners,
            recipient: toAddress,
        },
        spendingFields,
        sigHashes: [],
    };

    const tx = await makeStxTokenTransferFrom(multisigData);
    // TODO: Make sure pubkeys are in transaction auth fields

    let encoded = base64_serialize(tx);
    console.log(`Unsigned multisig transaction: ${encoded}`)
  } else if (args[0] == "sign") {
    const app = new StxApp(transport);
    const inputPayload = await readInput("Unsigned or partially signed transaction input");
    const hdPath = await readInput("Signer path (HD derivation path)");

    const tx = base64_deserialize(inputPayload) as StxTx.StacksTransaction;
    console.log("    *** Please check and approve signing on Ledger ***");
    const signed_tx = await ledgerSignMultisigTx(app, hdPath, tx);
    const encoded = base64_serialize(signed_tx);
    console.log(`Signed multisig transaction: ${encoded}`)    
  }

  await transport.close();
}

var inputs = process.argv.slice(2);

main(inputs)
  .then(x => { console.log("") })
