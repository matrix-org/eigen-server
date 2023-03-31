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
    const keep = config.keepUnder[obj["type"]];
    if (!!keep) {
        for (const [field, fields] of Object.entries(keep)) {
            if (typeof obj[field] !== "object") {
                throw new Error(`Expected to redact an object at ${field}, but received a non-object`);
            }
            newObj[field] = redactObject(obj[field], {keepTopLevel: fields, keepUnder: {}});
        }
    }
    return newObj;
}
