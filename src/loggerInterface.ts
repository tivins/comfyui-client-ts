export interface LoggerInterface {
    debug(s: string, d: any): void;
    log(s: string, d: any): void;
    warn(s: string, d: any): void;
    error(s: string, d: any): void;
}
export class DefaultLogger implements LoggerInterface {
    debug(s: string, d: any): void {
        console.debug(s,d);
    }

    error(s: string, d: any): void {
        console.error(s,d);
    }

    log(s: string, d: any): void {
        console.log(s,d);
    }

    warn(s: string, d: any): void {
        console.warn(s,d);
    }
}