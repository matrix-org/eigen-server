export const KeepAllFields: symbol = Symbol("*");

export type RedactConfig = {
    keepTopLevel: string[];
    contentFields: {
        [type: string]: string[] | typeof KeepAllFields;
    };
};
export function redactObject(obj: any, config: RedactConfig): any {
    const newObj: any = {};
    for (const field of config.keepTopLevel) {
        if (obj.hasOwnProperty(field)) {
            newObj[field] = obj[field];
        }
    }

    const keepContent = config.contentFields[obj["type"]] || [];
    newObj.content = {};
    if (Array.isArray(keepContent)) {
        for (const field of keepContent) {
            newObj.content[field] = obj.content[field];
        }
    } else if (keepContent === KeepAllFields) {
        newObj.content = JSON.parse(JSON.stringify(obj.content));
    }

    return newObj;
}
