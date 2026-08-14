export const normalizePair = (a, b) => (a < b ? [a, b] : [b, a]);
export const pairKey = (a, b) => {
    const [x, y] = normalizePair(a, b);
    return `${x}-${y}`;
};
export const validatePair = (a, b, blacklist, history) => {
    const key = pairKey(a, b);
    if (blacklist.has(key)) {
        return { valid: false, reason: "La pareja está en blacklist" };
    }
    if (history.has(key)) {
        return { valid: false, reason: "La pareja ya jugó junta" };
    }
    return { valid: true };
};
export const validatePairWithRules = (a, b, blacklist, history, options) => {
    if (options?.forbidAbusoAbuso && options.tierById?.get(a) === "ABUSO" && options.tierById?.get(b) === "ABUSO") {
        return { valid: false, reason: "Dos abusos no pueden jugar juntos." };
    }
    return validatePair(a, b, blacklist, history);
};
const generatePairsWithPredicate = (players, canPair) => {
    const used = new Set();
    const pairs = [];
    const conflicts = [];
    for (let i = 0; i < players.length; i += 1) {
        const p1 = players[i];
        if (used.has(p1))
            continue;
        let chosen = null;
        for (let j = i + 1; j < players.length; j += 1) {
            const p2 = players[j];
            if (used.has(p2))
                continue;
            if (canPair(p1, p2)) {
                chosen = p2;
                break;
            }
        }
        if (chosen === null) {
            conflicts.push(`No se pudo asignar pareja válida a jugador ${p1}`);
            continue;
        }
        used.add(p1);
        used.add(chosen);
        pairs.push(normalizePair(p1, chosen));
    }
    return { pairs, conflicts };
};
export const generatePairs = (players, blacklist, history) => generatePairsWithPredicate(players, (a, b) => validatePair(a, b, blacklist, history).valid);
export const selectSeedPlayerIds = (attendees, seedCount) => {
    const abusos = attendees.filter((player) => player.tier === "ABUSO");
    const mortales = attendees.filter((player) => player.tier !== "ABUSO");
    if (abusos.length >= seedCount) {
        return abusos.slice(0, seedCount).map((player) => player.id);
    }
    const seedIds = abusos.map((player) => player.id);
    for (const mortal of mortales) {
        if (seedIds.length >= seedCount)
            break;
        seedIds.push(mortal.id);
    }
    return seedIds.slice(0, seedCount);
};
export const generatePairsWithTiers = (players, tierById, blacklist, history, mode) => {
    if (mode === "FECHA_LIBRE") {
        return generatePairs(players, blacklist, history);
    }
    const canPair = (a, b) => validatePairWithRules(a, b, blacklist, history, { forbidAbusoAbuso: true, tierById }).valid;
    const abusos = players.filter((id) => tierById.get(id) === "ABUSO");
    const mortales = players.filter((id) => tierById.get(id) !== "ABUSO");
    const used = new Set();
    const pairs = [];
    const conflicts = [];
    for (const abuso of abusos) {
        if (used.has(abuso))
            continue;
        let matched = false;
        for (const mortal of mortales) {
            if (used.has(mortal))
                continue;
            if (!canPair(abuso, mortal))
                continue;
            used.add(abuso);
            used.add(mortal);
            pairs.push(normalizePair(abuso, mortal));
            matched = true;
            break;
        }
        if (!matched) {
            conflicts.push(`No se encontró mortal disponible para abuso ${abuso}`);
        }
    }
    const remaining = players.filter((id) => !used.has(id));
    const rest = generatePairsWithPredicate(remaining, (a, b) => {
        if (tierById.get(a) === "ABUSO" && tierById.get(b) === "ABUSO")
            return false;
        return validatePair(a, b, blacklist, history).valid;
    });
    return {
        pairs: [...pairs, ...rest.pairs],
        conflicts: [...conflicts, ...rest.conflicts]
    };
};
