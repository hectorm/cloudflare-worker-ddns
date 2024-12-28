# Cloudflare Dynamic DNS worker

[Dynamic DNS](https://help.dyn.com/remote-access-api/perform-update/) service implementation for Cloudflare Workers.

## Deployment instructions

 1. Create the desired DNS record(s) in Cloudflare.
 2. [Deploy the worker](https://developers.cloudflare.com/workers/get-started/).
 3. Set the following [variables and secrets](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard) in the worker dashboard:
    - `DDNS_USERNAME`: a username for the Dynamic DNS service.
    - `DDNS_PASSWORD`: a password for the Dynamic DNS service.
    - `DDNS_RECORD_ALLOWLIST`: a comma-separated list of DNS record(s) that the Dynamic DNS service is allowed to update (optional).
    - `CF_API_TOKEN`: a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with the `Zone.DNS:Edit` permission.
 4. Test the worker with the following command (optional):
    ```sh
    curl --verbose --user "<username>" "https://<worker-name>.<subdomain>.workers.dev/nic/update?hostname=<hostname>&myip=<ip>"
    ```

## Setup with UniFi OS

> [!NOTE]
> Tested on UDM-Pro-Max with UniFi OS 4.0.21 (Network 8.6.9 - inadyn 2.12.0).

 1. Log in to the [UniFi OS Controller](https://unifi.ui.com) web interface.
 2. Navigate to `Settings` -> `Internet` -> WAN interface -> `Advanced` -> `Dynamic DNS`.
 3. Set the following options:
    - `Service`: `custom`.
    - `Hostname`: the DNS record to update, must be in the `DDNS_RECORD_ALLOWLIST` if set.
    - `Username`: same as the `DDNS_USERNAME` worker variable.
    - `Password`: same as the `DDNS_PASSWORD` worker variable.
    - `Server`: `<worker-name>.<subdomain>.workers.dev/nic/update?hostname=%h&myip=%i`, **do not include** the `https://` scheme (it is added automatically), `%h` and `%i` are placeholders that UniFi OS automatically fills in.
 4. Test the configuration by running the following command in the [UniFi OS shell](https://help.ui.com/hc/en-us/articles/204909374-UniFi-Connect-with-Debug-Tools-SSH) (optional):
    ```sh
    inadyn --foreground --once --force --loglevel debug --config /run/ddns-ppp0-inadyn.conf
    ```
