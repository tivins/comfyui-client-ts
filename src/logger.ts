/**
 * Reçoit les messages de suivi du client (file, progression, téléchargement).
 * Les signatures sont celles de `console`, qui peut être passé tel quel.
 */
export interface Logger {
    debug(message: string, ...data: unknown[]): void;
    log(message: string, ...data: unknown[]): void;
    warn(message: string, ...data: unknown[]): void;
    error(message: string, ...data: unknown[]): void;
}

/** Logger par défaut : n'affiche rien. */
export const silentLogger: Logger = {
    debug() {},
    log() {},
    warn() {},
    error() {},
};
