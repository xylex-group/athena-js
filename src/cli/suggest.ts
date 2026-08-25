/**
 * Closest-token suggestions for unknown CLI commands and flags.
 */

export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}

	const row = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i += 1) {
		let previous = i - 1;
		row[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const current = row[j] ?? 0;
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min(
				(row[j] ?? 0) + 1,
				(row[j - 1] ?? 0) + 1,
				previous + cost
			);
			previous = current;
		}
	}
	return row[b.length] ?? b.length;
}

function maxSuggestDistance(token: string): number {
	if (token.length <= 3) {
		return 1;
	}
	if (token.length <= 8) {
		return 2;
	}
	return 3;
}

export function closestMatches(
	token: string,
	candidates: readonly string[],
	limit = 3
): string[] {
	const needle = token.toLowerCase();
	const maxDistance = maxSuggestDistance(needle);
	const ranked = candidates
		.filter((candidate) => candidate.length > 0)
		.map((candidate) => ({
			candidate,
			distance: levenshtein(needle, candidate.toLowerCase()),
		}))
		.filter(
			({ candidate, distance }) =>
				distance > 0 &&
				distance <= maxDistance &&
				distance < candidate.length
		)
		.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			return left.candidate.localeCompare(right.candidate);
		});

	const unique: string[] = [];
	for (const { candidate } of ranked) {
		if (!unique.includes(candidate)) {
			unique.push(candidate);
		}
		if (unique.length >= limit) {
			break;
		}
	}
	return unique;
}

export function formatDidYouMean(matches: readonly string[]): string {
	if (matches.length === 0) {
		return "";
	}
	if (matches.length === 1) {
		return `Did you mean ${matches[0]}?`;
	}
	return `Did you mean one of: ${matches.join(", ")}?`;
}
