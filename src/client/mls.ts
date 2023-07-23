import {Credential, DmlsCryptoProvider, DmlsGroup} from "@matrix-org/matrix-dmls-wasm";
import {unpaddedBase64Encode} from "../server/util/b64";
import {LocalState} from "./local_state";

const idEncoder = new TextEncoder();
const mlsGroups = new Map<string, DmlsGroup>();
const mlsMembers = new Map<string, Map<string, Set<string>>>();
const mlsStorage = new Map<string, number[]>();
// const mlsEpochs = new Map<string, Map<BigInt, Map<string, string>>>();
const dmls = new DmlsCryptoProvider(storeMls, readMls, getMlsKeys);
let mlsCredential: Credential;

type MlsStorageKey = [number[], number, number[], boolean];

function storeMls(key: MlsStorageKey, value: number[]) {
    mlsStorage.set(mlsKeyToString(key), value);
}

function readMls(key: MlsStorageKey): number[] | undefined {
    return mlsStorage.get(mlsKeyToString(key));
}

async function getMlsKeys(users: Uint8Array[]): Promise<(Uint8Array | undefined)[]> {
    // TODO: @TR: This!!
    return users.map(u => undefined);
}

function mlsKeyToString(key: MlsStorageKey): string {
    // [ groupId, epoch, creator, historical ]
    return `${unpaddedBase64Encode(Buffer.from(key[0]))}|${key[1]}|${unpaddedBase64Encode(Buffer.from(key[2]))}|${
        key[3]
    }`;
}

function makeMlsId(userId: string, deviceId: string): Uint8Array {
    return idEncoder.encode(`${userId}|${deviceId}`);
}

export function mlsLogin(userId: string, deviceId: string) {
    mlsCredential = new Credential(dmls, makeMlsId(userId, deviceId));
}

export function mlsMakeGroup(roomId: string) {
    const group = new DmlsGroup(dmls, mlsCredential, idEncoder.encode(roomId));
    mlsGroups.set(roomId, group);

    // Track ourselves as part of the group
    mlsMembers.set(roomId, new Map<string, Set<string>>());
    mlsMembers.get(roomId)!.set(LocalState.myUserId!, new Set([LocalState.myDeviceId!]));

    // TODO: Epochs
}

export function mlsGetState(roomId: string): Uint8Array {
    return mlsGroups.get(roomId)!.public_group_state(dmls);
}
