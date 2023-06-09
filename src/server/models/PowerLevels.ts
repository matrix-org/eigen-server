import {MatrixEvent} from "./event";

type PowerAction = "invite" | "kick" | "ban" | "redact" | "notifications.room";

export class PowerLevels {
    public constructor(private event: MatrixEvent | undefined, private createEvent: MatrixEvent) {}

    public getUserLevel(userId: string): number {
        if (this.event === undefined) {
            return userId === this.createEvent.sender ? 100 : 0;
        }

        const explicitLevel = this.event?.content["users"]?.[userId];
        if (Number.isInteger(explicitLevel)) {
            return explicitLevel;
        }

        const defaultLevel = this.event?.content["users_default"];
        if (Number.isInteger(defaultLevel)) {
            return defaultLevel;
        }

        return 0;
    }

    public getLevelForAction(action: PowerAction): number {
        let requiredLevel = action === "invite" ? 0 : 50;
        if (action === "notifications.room") {
            const n = this.event?.content["notifications"]?.["room"];
            if (Number.isInteger(n)) {
                requiredLevel = n;
            }
        } else {
            const n = this.event?.content[action];
            if (Number.isInteger(n)) {
                requiredLevel = n;
            }
        }
        return requiredLevel;
    }

    public canUserDo(userId: string, action: PowerAction): boolean {
        const requiredLevel = this.getLevelForAction(action);
        const userLevel = this.getUserLevel(userId);
        return userLevel >= requiredLevel;
    }

    public canUserSend(userId: string, eventType: string, isState: boolean): boolean {
        let requiredLevel = isState ? 50 : 0;

        const defaultLevel = isState ? this.event?.content["state_default"] : this.event?.content["events_default"];
        if (Number.isInteger(defaultLevel)) {
            requiredLevel = defaultLevel;
        }

        const eventLevel = this.event?.content["events"]?.[eventType];
        if (Number.isInteger(eventLevel)) {
            requiredLevel = eventLevel;
        }

        const userLevel = this.getUserLevel(userId);
        return userLevel >= requiredLevel;
    }
}
