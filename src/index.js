const SpecTransport = require("@ledgerhq/hw-transport-node-speculos").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;
const StxApp = require("@zondax/ledger-blockstack").default;
const LedgerError = require("@zondax/ledger-blockstack").LedgerError;
const btc = require('bitcoinjs-lib');
const C32 = require('c32check');
const BigNum = require('bn.js');

const Zemu = require('@zondax/zemu');

const StxTx = require("@stacks/transactions");

// This will generate pubkeys using
//  the format: m/44'/5757'/0'/0/x

const XPUB_PATH = `m/5757'/0'/0`

async function getPubKey(app, index) {
  let amt = (await app.getAddressAndPubKey(`${XPUB_PATH}/0/${index}`, StxTx.AddressVersion.TestnetSingleSig));
  console.log(amt);
  return amt.publicKey.toString('hex')
}

async function ledgerSignTx(app, path, partialFields, unsignedTx, prevSigHash, fullyUnsignedTx) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');

  const outFields = partialFields.slice();
  const pubkeys = partialFields
        .map((x) => {
          if (x.contents.type == StxTx.StacksMessageType.PublicKey) {
            return x.contents.data.toString('hex')
          } else {
            return null
          }
        });

  if (pubkeys.indexOf(pubkey) < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx fields: ${partialFields}`);
  }

  let resp;
  if (prevSigHash) {
    let txBuffer = fullyUnsignedTx;
    let postSigHashBuffer = Buffer.from(prevSigHash, 'hex');
    let pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    let prev_signer = Buffer.from(partialFields[0].contents.data, 'hex');
    let msg_array = [txBuffer, postSigHashBuffer, pkEnc, prev_signer];
    resp = await app.sign(path, Buffer.concat(msg_array));
  } else {
    resp = await app.sign(path, unsignedTx.serialize());
  }

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
    throw new Error('Ledger responded with errors');
  }

  const next_sighash = resp.postSignHash.toString("hex");

  console.log(next_sighash);

  const index = pubkeys.indexOf(pubkey);
  outFields[index] = StxTx.createTransactionAuthField(
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
//  console.log(makeMultiSigAddr(pubkeys, 2));

  const transaction = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
  });

  const signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction
}


async function generateMultiUnsignedTx(app) {
/*  let pk0 = await getPubKey(app, 0);
  let pk1 = await getPubKey(app, 1);
  let pk2 = await getPubKey(app, 2);

  let pubkeys = [pk0, pk1, pk2];*/

  let pubkeys = [
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
      return StxTx.createTransactionAuthField(StxTx.createStacksPublicKey(x))
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

async function generateMultiSigAddr(app) {
  let pk0 = await getPubKey(app, 0);
  let pk1 = await getPubKey(app, 1);
  let pk2 = await getPubKey(app, 2);

  return makeMultiSigAddr([pk0, pk1, pk2], 2);
}

async function main(args) {
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

    let result = await ledgerSignTx(app, `${XPUB_PATH}/0/0`, pubkeys, unsignedTx);
    let out1 = result.outFields;
    let post_sighash = result.next_sighash;

    unsignedTx.auth.spendingCondition.fields = out1;

    result = await ledgerSignTx(app, `${XPUB_PATH}/0/1`, out1, unsignedTx, post_sighash, fullyUnsignedTx);
    let out2 = result.outFields;
    post_sighash = result.next_sighash;

    unsignedTx.auth.spendingCondition.fields = out2;

    console.log(`Finished tx: ${unsignedTx.serialize().toString('hex')}`);
  }

  await transport.close();
}

var inputs = process.argv.slice(2);

main(inputs)
  .then(x => { console.log("") })
