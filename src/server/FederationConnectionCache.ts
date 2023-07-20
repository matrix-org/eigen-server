import * as dns from "dns/promises";

export type FederationUrl = {
    certificateHostname: string;
    httpsUrl: string;
};

export class FederationConnectionCache {
    private constructor() {}

    // TODO: Actually do caching

    public static async getFederationUrl(domain: string, withWellKnown = true): Promise<FederationUrl> {
        const urlForName = (name: string): string => {
            if (process.env["ES_INSECURE_HTTP"] === "true") {
                // noinspection HttpUrlsUsage
                return `http://${name}`;
            }
            return `https://${name}`;
        };

        // Ugly way to check for a port
        if (domain.match(/:[0-9]{1,5}$/)) {
            return {certificateHostname: domain.split(":")[0], httpsUrl: urlForName(domain)};
        }

        if (withWellKnown) {
            try {
                const wk = await fetch(`https://${domain}/.well-known/matrix/server`);
                if (wk.status === 200) {
                    const j = await wk.json();
                    if (typeof j["m.server"] === "string") {
                        return FederationConnectionCache.getFederationUrl(j["m.server"], false);
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        try {
            const srv = await dns.resolveSrv(`_matrix._tcp.${domain}`);
            if (srv.length > 0) {
                return {certificateHostname: domain, httpsUrl: urlForName(`${srv[0].name}:${srv[0].port}`)};
            }
        } catch (e) {
            // ignore
        }

        return {certificateHostname: domain, httpsUrl: urlForName(`${domain}:8448`)};
    }
}
