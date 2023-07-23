import {DSRoom} from "./room";

const dsRooms = new Map<string, DSRoom>();

export function tryAddRoom(roomId: string): DSRoom {
    if (!dsRooms.has(roomId)) {
        dsRooms.set(roomId, new DSRoom(roomId));
    } else {
        throw new Error("Cannot add this room");
    }

    return getRoom(roomId)!;
}

export function getRoom(roomId: string): DSRoom | undefined {
    return dsRooms.get(roomId);
}
