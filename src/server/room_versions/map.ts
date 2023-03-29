import {RoomVersion} from "./RoomVersion";
import {IDMimiLinearized00} from "./impl/IDMimiLinearized00";

const roomVersionImpls = new Map<string, RoomVersion>();

export const DefaultRoomVersion = "org.matrix.i-d.ralston-mimi-linearized-matrix.00";

roomVersionImpls.set(DefaultRoomVersion, new IDMimiLinearized00());

export function getRoomVersionImpl(version: string): RoomVersion | undefined {
    return roomVersionImpls.get(version);
}
