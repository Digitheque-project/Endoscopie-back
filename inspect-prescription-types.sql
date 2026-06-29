SELECT "typeExamen", COUNT(*) AS count
FROM "Prescription"
GROUP BY "typeExamen"
ORDER BY count DESC, "typeExamen";
SELECT id, name, code, description
FROM "EndoscopyExamType"
ORDER BY name;
