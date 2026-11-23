-- Un rapporteur ne peut signaler qu'une fois la même cible.
CREATE UNIQUE INDEX "Report_reporterId_offerId_key" ON "Report"("reporterId", "offerId");
CREATE UNIQUE INDEX "Report_reporterId_reviewId_key" ON "Report"("reporterId", "reviewId");
CREATE UNIQUE INDEX "Report_reporterId_reportedUserId_key" ON "Report"("reporterId", "reportedUserId");
