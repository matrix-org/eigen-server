import * as crypto from "crypto";
import {getDomainFromId} from "../util/id";

export class Room {
    public readonly joined: string[] = [];
    private invited: string[] = [];

    public constructor(public readonly roomId: string, public readonly creator: string) {
        this.joined.push(creator);
    }

    public isJoined(userId: string) {
        return this.joined.includes(userId) || userId === this.creator;
    }

    public join(userId: string) {
        if (this.joined.includes(userId)) {
            throw new Error("User already joined");
        }
        if (!this.invited.includes(userId)) {
            throw new Error("No invite pending");
        }
        this.joined.push(userId);
        this.invited = this.invited.filter(u => u !== userId);
    }

    public invite(userId: string) {
        if (this.joined.includes(userId)) {
            throw new Error("User already joined");
        }
        if (this.invited.includes(userId)) {
            throw new Error("User already invited");
        }
        this.invited.push(userId);
    }
}

export function createRoom(creator: string): Room {
    const serverName = getDomainFromId(creator);
    const localpart = crypto.randomUUID();
    return new Room(`!${localpart}:${serverName}`, creator);
}
