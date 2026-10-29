# Production analytics on IT Кедр domains

All old, current and future public HTML pages served at it-kedr.ru or its subdomains must include Yandex.Metrika counter113884564, with the owner's supplied options (including Webvisor). This applies to releases, new pages and new subdomains.

Production on201.24.61.235 uses the shared nginx snippet /etc/nginx/snippets/it-kedr-metrika.conf. It adds the external same-origin bootstrap and noscript pixel to every HTML response, so changing application releases does not remove analytics. Do not add a duplicate inline counter. New public virtual hosts must include that snippet and permit the documented Metrika endpoints in CSP. Preserve current TLS, domain verification files and unrelated services.

Before completing a deployment run /usr/local/sbin/it-kedr-check-metrika, adding URLs of newly published pages as arguments, then verify real browser collector requests. Presence in HTML alone does not prove recording in dashboard reports. New domains outside it-kedr.ru must not inherit this counter without authorization; the bootstrap has a hostname guard.

Keep file inputs, queues, names, thumbnails, errors, downloads and other user file data excluded from Webvisor using ym-hide-content / ym-disable-keys / ym-disable-tracklink before data enters the DOM. Never send filenames or file contents as analytics event properties. Changes to these exclusions require browser verification. Preserve local compression and conversion, TTL15min and limits.
