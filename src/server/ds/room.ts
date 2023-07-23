import {DmlsGroup} from "@matrix-org/matrix-dmls-wasm";

export class DSRoom {
    public mlsPublicState: Uint8Array | undefined;

    public constructor(public readonly roomId: string) {}

    private get group(): DmlsGroup {
        return DmlsGroup.new_from_welcome();
    }

    public getMemberUserIds(): string[] {}
}
