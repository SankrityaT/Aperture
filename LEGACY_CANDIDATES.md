//created by kinjal
# Real legacy systems we may use in the live demo

Checked read-only on Oct 18, about 4:00–4:15 AM PT. For each site: the login page (curl plus a headless browser),
the vendor's own demo page, a CAPTCHA or bot check, and the reset policy. Nothing was logged into and nothing was
written.

What counts: a legacy-style UI (server-rendered forms and tables), a public demo meant to be tried, a published
login, writes that are acceptable (ideally with resets), no CAPTCHA or bot check, and no bank or card numbers in
the task.

## Shortlist

| Rank | System | Demo | Why it fits | Reset | Watch out |
|---|---|---|---|---|---|
| 1 | **webERP** (PHP accounting/ERP, very old-school UI) | https://www.weberp.org/demo/ | The login is printed on the login screen ("Login as user: admin with password: weberp"), with company "pizzeria". The vendor says "try the live demo". | **Hourly** ("v5 head, reset hourly", weberp.org) | It's shared with the public. Keep the tasks off bank-account screens. |
| 2 | **OpenEMR** (PHP medical records) | https://demo.openemr.io/openemr | "Fully functional demo installations for you to try out". The login is published on open-emr.org/demo. Sanki's held-out read-only run already worked. | **Daily**, 08:00 UTC. 3 identical copies (Main, `/a/`, `/b/`) "in case a demo is down or has been modified" | It's shared. The data is fake, but keep recordings to demo patients. |
| 3 | **Dolibarr** (PHP ERP/CRM) | https://demo.dolibarr.org | Dolibarr calls it a "restricted shared demo" with demo profiles. A self-hosted copy is already in the repo (`targets/dolibarr`). | Not stated | The shared demo is restricted. Self-hosted is the safer path for writes. |
| 4 | **vtiger CRM** (PHP) | https://demo.vtiger.com/vtigercrm/ | The login form is live, with no CAPTCHA right now | Not stated | It sits behind Cloudflare. No login is published on the page; not yet checked. |

## Ruled out

- **Koha** (`demo.bywatersolutions.com`) and **OpenMRS** (`demo.openmrs.org`) show a Cloudflare bot check
  ("Attention Required" or "Just a moment..."). We never get around those.
- **SuiteCRM**: there is a CAPTCHA on the demo.
- **OrangeHRM**: a modern app. Wicket correctly refuses writes there (no unique key).
- **Gibbon, FrontAccounting, OpenCATS, GLPI, osTicket**: the demo hosts were unreachable at 4 AM PT.
- **GovStack and DIGIT**: modern JavaScript apps, not legacy. GovStack enrollment also needs bank numbers (an IBAN).
- **CitizenLink**: legacy look, but public search only, almost no data, and writes need a vendor-issued login.

## Terms

None of these demos publishes an automation policy. webERP and OpenEMR explicitly invite people to try fully working
demos and reset them on a schedule. We treat that as permission for test actions, with run-scoped test names, and we
say exactly that in the submission. We do not claim explicit permission for automation.

## To use one with Wicket (Sanki's side)

1. Add the host to `WICKET_ALLOWED_HOSTS` on the browser worker and restart the worker (about 10 minutes, per Sanki's
   agent).
2. Store the published demo login on the worker as `WICKET_CREDS_<SITE>`. No agent types a password.
3. Compile read-only first. Then use writes only on records the run creates itself, with run-scoped names
   (`WKT-TEST-...`).
