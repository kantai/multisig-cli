const SpecTransport = require("@ledgerhq/hw-transport-node-speculos").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const StxApp = require("@zondax/ledger-blockstack").default;
const LedgerError = require("@zondax/ledger-blockstack").LedgerError;
const btc = require('bitcoinjs-lib');
const C32 = require('c32check');
const BigNum = require('bn.js');

const Zemu = require('@zondax/zemu');
const readline = require('readline');
const util = require('util');

const StxTx = require("@stacks/transactions");

// This will generate pubkeys using
//  the format: m/44'/5757'/0'/0/x
const XPUB_PATH = `m/44'/5757'/0'`;

// This will generate pubkeys using
//  the format: m/5757'/0'/0/0/x
const BTC_MULTISIG_SCRIPT_PATH = `m/5757'/0'/0`;


async function getPubKey(app, index) {
  let amt = (await app.getAddressAndPubKey(`${XPUB_PATH}/0/${index}`, StxTx.AddressVersion.TestnetSingleSig));
  console.log(amt);
  return amt.publicKey.toString('hex')
}

/// Builds spending condition fields out of a multisig data serialization
function makeSpendingConditionFields(multisigData) {
  let fields = multisigData.spendingFields
      .map((field) => {
        if (field.signatureVRS) {
          return StxTx.createMessageSignature(field.signatureVRS);
        } else if (field.publicKey) {
          return StxTx.createStacksPublicKey(field.publicKey);
        } else {
          throw "spendingField in the multisig object did not have publicKey specification"
        }
      })
      .map((x) => {
        return StxTx.createTransactionAuthField(x);
      })
  return fields
}

function encodeMultisigData(multisigData) {
  return Buffer.from(JSON.stringify(multisigData)).toString('base64');
}

function decodeMultisigData(serialized) {
  return JSON.parse(Buffer.from(serialized, 'base64'));
}

async function finalizeMultisigTransaction(multisigData) {
  if (multisigData.tx.numSignatures != multisigData.sigHashes.length) {
    throw new Error(`Multisig transaction cannot be finalized, expected ${multisigData.tx.numSignatures} signatures, but only found  ${multisigData.sigHashes.length}`);
  }

  let unsignedTx = await makeStxTokenTransferFrom(multisigData);
  unsignedTx.auth.spendingCondition.fields = makeSpendingConditionFields(multisigData);

  return unsignedTx.serialize().toString('hex');
}

function updateMultisigData(multisigData, sigHash, signatureVRS, index) {
  multisigData.sigHashes.push(sigHash);
  multisigData.spendingFields[index].signatureVRS = signatureVRS;
}

/// Builds an unsigned transfer out of a multisig data serialization
async function makeStxTokenTransferFrom(multisigData) {
  let fee = new BigNum(multisigData.tx.fee, 10);
  let amount = new BigNum(multisigData.tx.amount, 10);
  let numSignatures = multisigData.tx.numSignatures;
  let publicKeys = multisigData.spendingFields.slice().map(field => field.publicKey);
  let memo = multisigData.tx.memo;
  let recipient = multisigData.tx.recipient;

  return (await makeUnsignedTransfer({ fee, amount, numSignatures, publicKeys, recipient, memo })).unsignedTx;
}

// Produce the signing buffer for a ledger device from the multisig data serialization
async function getLedgerSigningBuffer(multisigData) {
  let unsignedTxBuff = (await makeStxTokenTransferFrom(multisigData)).serialize();

  if (multisigData.sigHashes.length == 0) {
    return unsignedTxBuff;
  } else if (multisigData.sigHashes.length == 1) {
    const postSigHashBuffer = Buffer.from(multisigData.sigHashes[0], 'hex');
    const pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    const prevSignature = Buffer.from(
      multisigData
        .spendingFields
        .find((field) => field.signatureVRS)
        .signatureVRS,
      'hex');
    return Buffer.concat([unsignedTxBuff, postSigHashBuffer, pkEnc, prevSignature]);
  } else {
    throw new Error(`Ledger Stacks app does not support validating more than 2 signatures in multisig transactions`);
  }
}

async function ledgerSignMultisigTx(app, path, multisigData) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');
  const pubkeys = multisigData.spendingFields
        .map((x) => {
          if (! x.signatureVRS) {
            return x.publicKey
          } else {
            return null
          }
        });
  const index = pubkeys.indexOf(pubkey);

  if (index < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx pubkeys: ${pubkeys}`);
  }

  const signingBuffer = await getLedgerSigningBuffer(multisigData);
  const resp = await app.sign(path, signingBuffer);

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
    throw new Error('Ledger responded with errors');
  }

  const sigHash = resp.postSignHash.toString("hex");
  const signatureVRS = resp.signatureVRS.toString("hex");

  return { sigHash, signatureVRS, index }
}

async function ledgerSignTx(app, path, partialFields, unsignedTx, prevSigHash) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');

  const outFields = partialFields.slice();
  const pubkeys = partialFields
        .map((x) => {
          console.log(x);
          if (! x.contents && x.pubKeyEncoding) {
            return x.pubKeyEncoding.data.toString('hex')
          } else if (x.contents.type == StxTx.StacksMessageType.PublicKey) {
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
    let prev_signer = Buffer.from(partialFields[index - 1].contents.data, 'hex');
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
  });

  let signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction
}


async function generateMultiUnsignedTx(app) {
  pubkeys = [
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
  });

  let partialFields =
    pubkeys.map((x) => {
      return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, StxTx.createStacksPublicKey(x))
    });

  return { unsignedTx, pubkeys: partialFields }
}

function makeMultiSigAddr(pubkeys, required) {
  let authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  let c32Addr = C32.b58ToC32(btcAddr);
  return c32Addr
}

async function makeUnsignedTransfer(options) {
  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer( options );
  const publicKeys = options.publicKeys.slice();
  return { unsignedTx, publicKeys }
}

function checkAddressPubKeyMatch(pubkeys, required, address) {
  // first try in sorted order
  let authorizedPKs = pubkeys.slice().sort().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  let c32Addr1 = C32.b58ToC32(btcAddr);
  if (c32Addr1 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  // try in order given
  authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  btcAddr = btc.payments.p2sh({ redeem }).address;
  let c32Addr2 = C32.b58ToC32(btcAddr);
  if (c32Addr2 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  throw `Public keys did not match expected address. Expected ${address}, but pubkeys correspond to ${c32Addr1} or ${c32Addr2}`
}

async function generateMultiSigAddr(app) {
  let pk0 = await getPubKey(app, 0);
  let pk1 = await getPubKey(app, 1);
  let pk2 = await getPubKey(app, 2);

  return makeMultiSigAddr([pk0, pk1, pk2], 2);
}

async function readInput(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = util.promisify(rl.question).bind(rl);

  const answer = await new Promise(resolve => {
    rl.question(`${query}? `, answer => resolve(answer))
  });

  rl.close();

  return answer;
}

async function main(args) {
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

  if (args[0] == "make_soft_multi") {
    let signed = await generateMultiSignedTx();
    console.log(`Signed tx: ${signed.serialize().toString('hex')}`);
    return
  }

  let transport = await SpecTransport.open({ apduPort: 40000 });
//    let transport = await TransportNodeHid.create();

  if (args[0] == "get_pub") {
    let app = new StxApp(transport);
    console.log(`Path: ${XPUB_PATH}/0/0`);
    let pubkey = await getPubKey(app, 0);
    console.log(`Pub: ${pubkey}`);
  } else if (args[0] == "make_multi") {
    let app = new StxApp(transport);
    let addr = await generateMultiSigAddr(app);
    console.log(`Addr: ${addr}`);
  } else if (args[0] == "make_sign_multi") {
    let app = new StxApp(transport);
    let { unsignedTx, pubkeys } = await generateMultiUnsignedTx(app);

    let fullyUnsignedTx = unsignedTx.serialize();
    console.log(`Unsigned tx: ${unsignedTx.serialize().toString('hex')}`);

    let result = await ledgerSignTx(app, `${XPUB_PATH}/0/0`, pubkeys, fullyUnsignedTx);
    let out1 = result.outFields;
    let post_sighash = result.next_sighash;

    unsignedTx.auth.spendingCondition.fields = out1;

    result = await ledgerSignTx(app, `${XPUB_PATH}/0/1`, out1, fullyUnsignedTx, post_sighash);
    let out2 = result.outFields;
    post_sighash = result.next_sighash;

    unsignedTx.auth.spendingCondition.fields = out2;

    console.log(`Finished tx: ${unsignedTx.serialize().toString('hex')}`);
  } else if (args[0] == "make_sign_multi_3") {
    let app = new StxApp(transport);
    let tx = {
      fee: "300",
      amount: "1000",
      numSignatures: 2,
      recipient: "SP000000000000000000002Q6VF78",
    }

    let pubkeys = [
      '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
//      '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
      '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
    ];

    let spendingFields = pubkeys.map((x) => { return { publicKey: x } });
    let sigHashes = [];

    let multisigData = { tx, spendingFields, sigHashes };

    let encoded = encodeMultisigData(multisigData);
    console.log(`Unsigned payload: ${encoded}`);
    multisigData = decodeMultisigData(encoded);

    let { sigHash, signatureVRS, index } = await ledgerSignMultisigTx(app, `${XPUB_PATH}/0/0`, multisigData);
    updateMultisigData(multisigData, sigHash, signatureVRS, index);

    encoded = encodeMultisigData(multisigData);
    console.log(`Signed once payload: ${encoded}`);
    multisigData = decodeMultisigData(encoded);

    ({ sigHash, signatureVRS, index } = await ledgerSignMultisigTx(app, `${XPUB_PATH}/0/2`, multisigData));
    updateMultisigData(multisigData, sigHash, signatureVRS, index);

    encoded = encodeMultisigData(multisigData);
    console.log(`Signed twice payload: ${encoded}`);
    multisigData = decodeMultisigData(encoded);


    console.log(`Finalized: ${await finalizeMultisigTransaction(multisigData)}`);
  }

  await transport.close();
}

var inputs = process.argv.slice(2);

main(inputs)
  .then(x => { console.log("") })
