import {RoomVersion} from "./RoomVersion";
import {IDMimiLinearized02} from "./impl/IDMimiLinearized02";

const roomVersionImpls = new Map<string, RoomVersion>();

export const DefaultRoomVersion = IDMimiLinearized02.Identifier;

roomVersionImpls.set(DefaultRoomVersion, new IDMimiLinearized02());

export function getRoomVersionImpl(version: typeof DefaultRoomVersion): RoomVersion;
export function getRoomVersionImpl(version: string): RoomVersion;
export function getRoomVersionImpl(version: string): RoomVersion | undefined {
    return roomVersionImpls.get(version);
}

export function getSupportedVersions(): string[] {
    return Array.from(roomVersionImpls.keys());
}
