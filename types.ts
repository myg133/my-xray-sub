export type CfEntry = {
  value: string;
  type: "ip" | "domain";
  avgScore: number;
  avgLatency: number;
  avgPkgLost: number;
  carrierCode?: "CT" | "CU" | "CM";
  carrierLatency?: number;
};

export type VlessParams = {
  id: string;
  host: string;
  port: number;
  path: string;
  network: "xhttp";
  security: "tls";
  sni: string;
  alpn: string;
  fingerprint: string;
  encryption: "none";
  mode: "auto";
  allowInsecure?: boolean;
};

export type SubQuery = {
  group: string;
  id: string;
  path: string;
  host: string;
  allowInsecure: boolean;
};
