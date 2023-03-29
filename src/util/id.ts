export function getDomainFromId(id: string): string {
    return id.split(":").slice(1).join(":");
}
