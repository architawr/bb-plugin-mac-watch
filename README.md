# bb-plugin-mac-watch

Мониторинг Мака, на котором работает BB-сервер. Страница в сайдбаре, CLI `bb mac-watch` и навык для агентов.

Описание для пользователей лежит в [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

## Разработка

```sh
npm install
npm test            # разбор вывода утилит на реальных фикстурах (test/fixtures)
npm run typecheck
bb plugin build
bb plugin install "$PWD" --yes   # или bb plugin reload mac-watch
```

- `core.ts`: чистые парсеры, предупреждения, вердикт «уснёт ли Мак», форматирование.
- `collector.ts`: запускает утилиты macOS и собирает `Snapshot`.
- `icons.ts`: иконки приложений из `.app` через `sips`, с кэшем.
- `server.ts`: фоновый опрос каждые 15 с, история за 24 ч, RPC и CLI.
- `app.tsx` и `style.css`: страница.

В фикстурах `test/fixtures` серийные номера батареи и адаптера заменены на `REDACTED`.
