# Cloudflare Pages 設定手順（Bay NYX 本番環境）

Bay NYX の公式サイトは **Cloudflare Pages** を本番環境として運用します。
GitHub の `main` ブランチへ push すると、Cloudflare Pages が自動でデプロイします。

> ⚠️ **APIキーの値そのものを、このファイル・GitHub・チャット・スクリーンショットへ
> 貼り付けないでください。** キーは Cloudflare の管理画面にだけ入力します。

---

## 1. サイトの構成

フレームワークは使っていない**静的HTML**サイトです。ビルドは不要です。

| 種類 | ファイル |
| --- | --- |
| ページ | `index.html` / `service.html` / `system.html` |
| スタイル | `styles.css` |
| microCMS表示 | `cms-content.js` |
| APIプロキシ | `functions/api/baynyx.js` |
| 画像 | `img/` |

動画ファイルはリポジトリに含みません（**Cloudinary** から配信）。

`functions/` ディレクトリは **Cloudflare Pages Functions** 用です。
ファイルの場所がそのままURLになります。

```
functions/api/baynyx.js  →  https://<サイト>/api/baynyx
```

このディレクトリはリポジトリのルートに置いたままにしてください。

---

## 2. Pages プロジェクトの作成

Cloudflare Dashboard で次のとおり操作します。

1. **Workers & Pages** を開く
2. **Create** をクリック
3. **Pages** タブを選ぶ
4. **Connect to Git** をクリック
5. GitHub アカウントを連携し、リポジトリを選ぶ

| 項目 | 設定値 |
| --- | --- |
| Repository | `hiroyukimaekawa-lang/Bay-NYX` |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | リポジトリのルート（空欄のまま） |
| Build command | `exit 0` |
| Build output directory | `.` |

> 💡 ビルドが不要なサイトのため、Build command は `exit 0`（何もせず成功）にします。
> Build output directory はルートを表す `.` です。

---

## 3. 環境変数（Variables and Secrets）

**Settings → Variables and Secrets** で設定します。

| 変数名 | 種類 | 必須 | 値 |
| --- | --- | --- | --- |
| `MICROCMS_API_KEY` | **Secret** | **必須** | microCMSのAPIキー |
| `MICROCMS_SERVICE_DOMAIN` | Text | 任意 | `l9pawk28o1` |
| `MICROCMS_ENDPOINT` | Text | 任意 | `baynyx` |

`MICROCMS_SERVICE_DOMAIN` と `MICROCMS_ENDPOINT` は
コード側に同じ既定値を持たせてあるため、
**最低限 `MICROCMS_API_KEY` だけ設定すれば動作します。**

`MICROCMS_API_KEY` は必ず **Secret**（暗号化）として登録してください。
Text で登録すると管理画面に値が表示されてしまいます。

### Production と Preview

Cloudflare Pages には **Production** と **Preview** の2つの環境があります。
プレビューURLでもmicroCMSの内容を確認したい場合は、
**両方に同じ変数を設定**してください。
Preview に設定しない場合、プレビューURLでは
`/api/baynyx` が `503` を返し、静的HTMLの内容が表示されます（サイトは壊れません）。

> 環境変数を追加・変更したあとは、**再デプロイが必要**です。
> **Deployments → 最新のデプロイ → Retry deployment** を実行してください。

### microCMSのAPIキーの取得場所

microCMS 管理画面 → **サービス設定** → **APIキー** → `GET` 権限のあるキー。
表示された値をコピーし、Cloudflare の Secret 欄へ貼り付けます。

---

## 4. デプロイの確認

### 4-1. APIの確認

ブラウザで次のURLを開きます。

```
https://<あなたのPagesドメイン>/api/baynyx
```

| 結果 | 意味 | 対処 |
| --- | --- | --- |
| `200` でJSONの `contents` 配列が返る | 正常 | — |
| `503` `{"error":"not_configured"}` | `MICROCMS_API_KEY` 未設定 | 第3章を設定して再デプロイ |
| `502` `{"error":"upstream_error"}` | APIキーが誤り／microCMS側エラー | キーの値と権限を確認 |

> `503` や `502` になってもサイト自体は壊れません。
> microCMSが読めないときは、HTMLに書かれた内容がそのまま表示されます。

### 4-2. ページの確認

| ページ | 確認内容 |
| --- | --- |
| `/` | CASTカードにmicroCMSの内容が反映される／動画が再生される |
| `/service.html` | FOODにmicroCMSの内容が反映される |

---

## 5. 更新のながれ

```
microCMSで編集 → 公開 → サイトを再読み込み
```

microCMSの内容はブラウザが表示のたびに取得するため、
**再デプロイは不要**です（最大5分ほどキャッシュされます）。

HTML・CSSを変更した場合のみ、GitHub の `main` へ push すると
Cloudflare Pages が自動で再デプロイします。

---

## 6. 動画について

動画ファイルは **Cloudinary** に置き、リポジトリには含めません。
変更手順は [`MICROCMS_SETUP.md`](MICROCMS_SETUP.md) の
「動画を変更する」を参照してください。

---

## 7. ローカルでの動作確認（開発者向け）

```bash
npx wrangler pages dev .
```

環境変数なしで起動した場合、`/api/baynyx` は `503 not_configured` を返します
（これは正常な動作です）。

APIキーを使ってローカル確認したい場合は、リポジトリのルートに
`.dev.vars` を作成します。

```
MICROCMS_API_KEY=（ここにキー）
```

`.dev.vars` は `.gitignore` に登録済みで、**コミットされません。**

---

## 8. Netlify からの切り替えについて

これまで使っていた `https://baynyx.netlify.app/` は、
**Cloudflare Pages の動作確認が完了するまで残します。**

Cloudflare 側で第4章の確認がすべて通ったあとに、
独自ドメインの向き先の変更や Netlify サイトの停止を検討してください。
（この作業は手動で行います。自動では切り替わりません。）
