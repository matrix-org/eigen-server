export type FederationUrl = {
    certificateHostname: string;
    httpsUrl: string;
};

export class FederationConnectionCache {
    private constructor() {}

    public static async getFederationUrl(domain: string): Promise<FederationUrl> {
        // TODO: Proper server resolution & discovery
        // https://github.com/matrix-org/linearized-matrix/issues/13

        // TODO: Support https properly
        // https://github.com/matrix-org/linearized-matrix/issues/14

        if (!domain.includes(":")) {
            domain = `${domain}:8338`; // XXX: Hardcoded!!
        }
        // noinspection HttpUrlsUsage
        return {certificateHostname: domain, httpsUrl: `http://${domain}`};
    }
}
