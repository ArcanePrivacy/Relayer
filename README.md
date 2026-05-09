# Relayer for Arcane Privacy

## Deploy with docker-compose (recommended)

_The following instructions are for Ubuntu 22.10, other operating systems may vary. These instructions include automated SSL configuration with LetsEncrypt._

**PREREQUISITES**

1. Update core dependencies

- `sudo apt-get update`

2. Install docker-compose

- `curl -SL https://github.com/docker/compose/releases/download/v2.16.0/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose`

3. Install Docker

- `curl -fsSL https://get.docker.com -o get-docker.sh && chmod +x get-docker.sh && ./get-docker.sh`

4. Install git

- `sudo apt-get install git-all`

5. Install nginx

- `sudo apt install nginx`

6. Stop apache2 instance (enabled by default)

- `sudo systemctl stop apache2`

**FIREWALL CONFIGURATION**

_\* Warning: Failure to configure SSH as the first UFW rule, will lock you out of the instance_

1. Make sure UFW is installed by running `apt update` and `apt install ufw`
2. Allow SSH in the first position in UFW by running `sudo ufw allow OpenSSH`\*
3. Allow HTTP, and HTTPS by running `sudo ufw allow http`, `sudo ufw allow https`
4. Finalize changes and enable firewall `sudo ufw enable`

**DEPLOYMENT**

1. Clone the repository and enter the directory

- `git clone https://github.com/SmoothWork1/arcane_relayer.git && cd arcane_relayer`

2. Clone the example environment file `.env.example` to configure for the preferred network - `cp .env.example .env` , then fill `.env` file.

- Set `PRIVATE_KEY` for your relayer address. Accepted formats: base58, JSON byte array (`[159,24,...]`), comma-separated bytes (`159,24,...`), or `0x`-prefixed hex (64-byte key).
- Set `RELAYER_FEE` to what you would like to charge as your fee (remember 0.3% is deducted from your staked relayer balance)
- Set `RANGE_API_KEY` (you can get key from [here](https://docs.range.org/introduction/getting-started))
- Set `RPC_URL` to a non-censoring RPC endpoint
- Set `REDIS_PASSWORD`
- Set `NET_ID=devnet` if you're running relayer on devnet

3. Clone the reverse-proxy environment file `.env.proxy.example` to configure your domain/TLS - `cp .env.proxy.example .env.proxy`, then fill `.env.proxy`.

- Set `VIRTUAL_HOST` and `LETSENCRYPT_HOST` to your domain address
  - add a A record DNS record with the value assigned to your instance IP address to configure the domain

4. Uncomment the `env_file` lines (remove `# `) for the associated network services in `docker-compose.yml`
5. Build and deploy the docker source by specifying the network through:

- `sudo apt install npm`
- `npm run build`
- `docker-compose up -d`

5. Visit your domain address and check the `/status` endpoint and ensure there is no errors in the `status` field

**NGINX REVERSE PROXY**

1. Copy the pre-modified nginx policy as your default policy

- `cp arcane.conf /etc/nginx/sites-available/default`

2. Append the default nginx configuration to include streams

- `echo "stream {  map_hash_bucket_size 128;  map_hash_max_size 128;  include /etc/nginx/conf.d/streams/*.conf; }" >> /etc/nginx/nginx.conf`

3. Create the stream configuration

- `mkdir /etc/nginx/conf.d/streams && cp arcane-stream.conf /etc/nginx/conf.d/streams/arcane-stream.conf`

4. Start nginx to make sure the configuration is correct

- `sudo systemctl restart nginx`

5. Stop nginx

- `sudo systemctl stop nginx`

## Run locally

1. `npm i`
2. `cp .env.example .env`
3. Modify `.env` as needed
4. `npm run start`
5. Go to `http://127.0.0.1:8000`
6. In order to execute withdraw request, you can run following command

```bash
curl -X POST -H 'content-type:application/json' --data '<input data>' http://127.0.0.1:8000/relay
```

Relayer should return a transaction hash.
