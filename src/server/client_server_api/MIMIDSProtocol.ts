// This isn't actually defined in MIMI DS, so we guess at its shape
export enum DSProtocolVersion {
    v1 = "v1",
}

export interface PartialGroupInfo {
    // group_info_extensions??
    //
}

export interface MLSGroupUpdate {
    groupInfo: PartialGroupInfo;
    commit: string; // unpadded base64
}

export interface DSRequestBody {
    type: string; // DSRequestType
}

export interface DSResponse {
    // no fields
}

// Not implemented (by choice):
// * Request group ID
// * DeleteGroupRequest
// *

export interface CreateGroupBody extends DSRequestBody {
    type: "create_group";
    groupId: string; // aka room ID, generated by client

    // Group ID MUST be suffixed with the server name for namespacing

    groupInfo: Uint8Array; // public group state??
}

export interface CreateGroupResponse extends DSResponse {
    error: undefined | "invalid_group_id" | "invalid_leaf_node" | "invalid_group_info";
}

export interface AddUsersBody extends DSRequestBody {
    type: "add_users";
}
