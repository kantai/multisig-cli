import 'bootstrap/dist/css/bootstrap.min.css';
export * from './lib';

import { MultisigData, updateMultisigData, decodeMultisigData, encodeMultisigData, makeMultiSigAddr, ledgerSignMultisigTx, finalizeMultisigTransaction } from './lib';
import StxApp from "@zondax/ledger-blockstack";
import LedgerTransportWeb from '@ledgerhq/hw-transport-webhid';
import BlockstackApp from '@zondax/ledger-blockstack';

function getInputElement(id: string): string {
    return (document.getElementById(id)! as HTMLInputElement).value.trim()
}

export function displayMessage(name: string, message: string, title: string) {
    const container = document.getElementById(name)!;
    container.classList.remove('invisible');
    const displayArea = document.getElementById(`${name}-message`)!;
    displayArea.innerHTML = message
  
    if (title) {
      const titleArea = document.getElementById(`${name}-title`)!;
      titleArea.innerHTML = title
    }
}

let LEDGER_APP_CONN: undefined | BlockstackApp = undefined;

export async function connectLedgerApp() {
    if (!LEDGER_APP_CONN) {
        const transport = await LedgerTransportWeb.create();
        const app = new StxApp(transport);
        LEDGER_APP_CONN = app;
        return app;
    } else {
        return LEDGER_APP_CONN;
    }
}

export async function sign_and_complete() {
    try {
        const app = await connectLedgerApp();
        const inputPayload = getInputElement('transact-input');
        const hdPath = getInputElement('transact-path');

        const multisigData = decodeMultisigData(inputPayload);
        const { sigHash, signatureVRS, index } = await ledgerSignMultisigTx(app, hdPath, multisigData);
        updateMultisigData(multisigData, sigHash, signatureVRS, index);
        let finished = await finalizeMultisigTransaction(multisigData);
        displayMessage('tx', `Finalized tx: <br/> <br/> ${finished}`, 'Finalized tx')    
    } catch(e: any) {
        displayMessage('tx', e.toString(), "Error signing transaction");
        throw e;
    }  
}

export async function sign_partial() {
    try {
        const app = await connectLedgerApp();
        const inputPayload = getInputElement('transact-input');
        const hdPath = getInputElement('transact-path');

        const multisigData = decodeMultisigData(inputPayload);
        const { sigHash, signatureVRS, index } = await ledgerSignMultisigTx(app, hdPath, multisigData);
        updateMultisigData(multisigData, sigHash, signatureVRS, index);
        let encoded = encodeMultisigData(multisigData);
        displayMessage('tx', `Payload: <br/> <br/> ${encoded}`, 'Partial Transaction')    
    } catch(e: any) {
        displayMessage('tx', e.toString(), "Error signing transaction");
        throw e;
    }
}

export function generate_transfer() {
    const fromAddr = getInputElement('from-address');
    const fromPKsHex = getInputElement('from-pubkeys').split(',').map(x => x.trim()).sort();
    const requiredSigners = parseInt(getInputElement('from-n'));
    const toAddress = getInputElement('to-address');
    const toSend = getInputElement('stacks-send');
    const fee = getInputElement('stacks-fee');
    const spendingFields = fromPKsHex.map(x => ({ publicKey: x }));

    const generatedMultiSigAddress = makeMultiSigAddr(fromPKsHex, requiredSigners);

    if (generatedMultiSigAddress !== fromAddr) {
        const message = `Public keys, required signers do not match expected address: expected=${fromAddr}, generated=${generatedMultiSigAddress}`;
        displayMessage('tx', message, "Error generating transaction");
        throw new Error(message);
    }

    let multisigData: MultisigData = {
        tx: {
            fee,
            amount: toSend,
            numSignatures: requiredSigners,
            recipient: toAddress,
        },
        spendingFields,
        sigHashes: [],
    };

    let encoded = encodeMultisigData(multisigData);
    displayMessage('tx', `Payload: <br/> <br/> ${encoded}`, 'Unsigned Transaction')
}

