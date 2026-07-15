const revisions = {
  sessionsRevision: 0,
  booksRevision: 0,
  tagsRevision: 0,
  wishlistRevision: 0,
};

export function getDatabaseRevisions() {
  return { ...revisions };
}

export function bumpDatabaseRevisions(...domains) {
  for (const domain of new Set(domains)) {
    const key = `${domain}Revision`;
    if (Object.hasOwn(revisions, key)) revisions[key] += 1;
  }
  return getDatabaseRevisions();
}

export function resetDatabaseRevisionsForTests() {
  Object.keys(revisions).forEach((key) => { revisions[key] = 0; });
}
