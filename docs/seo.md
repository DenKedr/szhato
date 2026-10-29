# SEO публичных страниц

Аудитория: русскоязычные пользователи, которым нужно бесплатно сжать PDF/фотографии, перевести PDF в JPEG/PNG/WebP или изображения в PDF. Региональные ограничения не заданы. Каталог отвечает запросу о бесплатных Open Source инструментах, страница /compressed — конкретной задаче обработки файлов.

В HTTP-ответе /compressed содержится готовая статическая разметка того же React-интерфейса и FAQ. Она генерируется во время npm run build через renderToString; Node-сервер в production не нужен. После загрузки JavaScript React включает локальную обработку. При отключённом JavaScript контент доступен, а уведомление объясняет необходимость JavaScript для работы с файлами.

Каталог и приложение имеют отдельные title/description, один H1, lang=ru, HTTPS canonical и внутренние ссылки. Query ?tool=convert — представление того же инструмента, canonical остаётся /compressed. /compressed/ и /compressed/index.html тоже указывают canonical /compressed. Единственный sitemap.xml содержит / и /compressed, robots.txt ссылается на карту и разрешает обход публичных ресурсов. Пользовательские файлы не попадают на сервер и не имеют публичных URL. Служебные тестовые страницы не входят в dist.

В каталоге добавлена микроразметка WebApplication, бесплатное предложение и автор без выдуманных рейтингов. CSP без inline script/unsafe-eval сохранена. Наличие микроразметки не означает гарантированный расширенный результат поиска.

Существующие HTTP→HTTPS301 и404длянесуществующихURL проверяются при выкладке. Мобильный интерфейс проверен на390px; горизонтальной прокрутки нет. Скорость проверяется локальными браузерными измерениями; полевых Core Web Vitals и измеренных поисковых позиций пока нет. Крупный JSбандл остаётся предметом дальнейшей оптимизации.

Официальные рекомендации сверены29.10.2026:

- [Google: JavaScript SEO и предварительный HTML](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google: создание и отправка Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Яндекс: robots.txt](https://yandex.ru/support/webmaster/ru/controlling-robot/robots-txt)
- [Яндекс: Sitemap](https://yandex.ru/support/webmaster/ru/controlling-robot/sitemap)

Состояние подтверждения в кабинетах, фактической индексации и отправки Sitemap фиксируется в отчёте развёртывания outputs/project-deployment.md. Репозиторий не содержит аккаунтных секретов; общедоступный метатег подтверждения Google находится в HTMLкаталога. HTMLпроверка Яндекса относится к настройке домена и добавляется при развёртывании.
