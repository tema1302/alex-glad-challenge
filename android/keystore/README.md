# Debug signing key

`debug.jks` — **только для debug-сборок** «Артели». Ключ лежит в репозитории
намеренно: APK, собранные на сервере и на Windows, должны обновлять друг друга
(Android отказывается ставить APK с другой подписью — `INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

- alias: `androiddebugkey`
- store/key password: `android`
- SHA-256: `DA:56:3E:C2:67:10:81:6F:3D:6E:DB:A5:A3:FD:D2:FF:CF:14:EA:31:E3:B5:73:36:83:EB:C7:9C:A1:27:77:CC`

Это не секрет и не release-ключ: release-сборки должны подписываться отдельным
ключом, которого здесь нет. Не используйте этот файл для публикации в сторах.
