import {RoomVersion} from "./RoomVersion";
import {IDMimiLinearized00} from "./impl/IDMimiLinearized00";

const roomVersionImpls = new Map<string, RoomVersion>();

export const DefaultRoomVersion = IDMimiLinearized00.Identifier;

roomVersionImpls.set(DefaultRoomVersion, new IDMimiLinearized00());

export function getRoomVersionImpl(version: typeof DefaultRoomVersion): RoomVersion;
export function getRoomVersionImpl(version: string): RoomVersion;
export function getRoomVersionImpl(version: string): RoomVersion | undefined {
    return roomVersionImpls.get(version);
}
