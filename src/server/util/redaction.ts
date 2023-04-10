export type RedactConfig = {
    keepTopLevel: string[];
    contentFields: {
        [type: string]: string[];
    };
};
export function redactObject(obj: any, config: RedactConfig): any {
    const newObj: any = {};
    for (const field of config.keepTopLevel) {
        newObj[field] = obj[field];
    }

    const keepContent = config.contentFields[obj["type"]] || [];
    const newContent: any = {};
    newObj.content = newContent;
    for (const field of keepContent) {
        newContent[field] = obj.content[field];
    }

    return newObj;
}
