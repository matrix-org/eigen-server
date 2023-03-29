import {createRoom, Room} from "../models/room";

export class RoomServer {
    private rooms: Room[] = []; // TODO: Persist

    public createRoom(creator: string): Room {
        const room = createRoom(creator);
        this.rooms.push(room);
        return room;
    }

    public getRoom(roomId: string): Room | undefined {
        return this.rooms.find(r => r.roomId === roomId);
    }
}
