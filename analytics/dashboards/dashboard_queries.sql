-- SAWS coordinator dashboard — login stats + total registered patients (Sprint 3 addition).
-- Add these as 2 more charts on the existing Looker Studio report
-- (https://lookerstudio.google.com/reporting/4484ec35-5a33-4268-a34e-12e21bd12ffa) —
-- the feedback/appointments charts already live there, sourced from
-- saws_analytics.feedback_dashboard / appointments_dashboard (see looker-setup.md §1.2).

-- Total registered patients.
-- role = 'Patient' excludes coordinators; role matches the Cognito group name (erd.md).
SELECT COUNT(DISTINCT username) AS total_patients
FROM saws_analytics.login_events
WHERE role = 'Patient';

-- Login statistics (logins per day).
SELECT DATE(timestamp) AS day,
       COUNT(*)        AS logins
FROM saws_analytics.login_events
GROUP BY day
ORDER BY day;
