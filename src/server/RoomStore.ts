import {Room} from "../models/Room";

export class RoomStore {
    private rooms: Room[] = []; // TODO: Persist

    public createRoom(creator: string): Room {
        const room = Room.create(creator);
        this.rooms.push(room);
        return room;
    }

    public getRoom(roomId: string): Room | undefined {
        return this.rooms.find(r => r.roomId === roomId);
    }
}
