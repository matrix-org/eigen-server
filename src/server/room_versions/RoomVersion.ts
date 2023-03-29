import {MatrixEvent} from "../../models/event";

export interface RoomVersion {
    /**
     * Applies the required schema and signature validations to the event, returning
     * false if any check fails.
     * @param event The event to validate.
     */
    isValid(event: MatrixEvent): boolean;
    /**
     * Determines if an event is allowed by the authorization rules for the room version,
     * given the room as a linearized DAG (index 0 should be the create event if not
     * validating the create event itself).
     * @param event The event to validate.
     * @param allEvents The events which have already been accepted, ordered.
     */
    isAllowed(event: MatrixEvent, allEvents: MatrixEvent[]): boolean;
    redact(event: MatrixEvent): object;
}
