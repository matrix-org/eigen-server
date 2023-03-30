export type RedactConfig = {
    keepTopLevel: string[];
    keepUnder: {
        [type: string]: Record<string, string[]>;
    };
};
export function redactObject(obj: any, config: RedactConfig): any {
    const newObj: any = {};
    for (const field of config.keepTopLevel) {
        newObj[field] = obj[field];
    }
    for (const [field, keepConfig] of Object.entries(config.keepUnder)) {
        if (typeof obj[field] !== "object") {
            throw new Error("Expected to redact an object, but received a non-object");
        }
        const keep = keepConfig[obj["type"]];
        if (!!keep) {
            newObj[field] = redactObject(obj[field], {keepTopLevel: keep, keepUnder: {}});
        }
    }
    return newObj;
}
