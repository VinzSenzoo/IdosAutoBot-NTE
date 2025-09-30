import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk from 'chalk';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ethers } from 'ethers';

const logger = {
  info: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || 'ℹ️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.green('INFO');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  warn: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '⚠️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.yellow('WARN');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  error: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '❌  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.red('ERROR');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  }
};

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function centerText(text, width) {
  const cleanText = stripAnsi(text);
  const textLength = cleanText.length;
  const totalPadding = Math.max(0, width - textLength);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
  const width = 80;
  console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
  console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
  console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
  logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, { emoji: '📍 ', context });
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getGlobalHeaders(token = null) {
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'content-type': 'application/json',
    'origin': 'https://app.idos.network',
    'priority': 'u=1, i',
    'referer': 'https://app.idos.network/',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': getRandomUserAgent()
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getAxiosConfig(proxy, token = null, extraHeaders = {}) {
  const config = {
    headers: { ...getGlobalHeaders(token), ...extraHeaders },
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logger.warn(`Unsupported proxy: ${proxy}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 5, backoff = 5000, context) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      const data = response.data;
      if (data && data.success === false) {
        return { success: false, message: data.error || 'Unknown error', status: response.status };
      }
      return { success: true, response: data };
    } catch (error) {
      const status = error.response ? error.response.status : null;
      let errMsg = error.message;
      if (error.response && error.response.data) {
        errMsg = error.response.data.error || error.response.data.message || errMsg;
      }
      if (status >= 400 && status < 500 && status !== 429) {
        return { success: false, message: errMsg, status };
      }
      let shouldRetry = false;
      if (status === 429 || (status >= 500 && status < 600)) {
        shouldRetry = true;
        if (status === 429) backoff = 30000;
      }
      if (shouldRetry && i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      logger.error(`Request failed after ${retries} attempts: ${error.message} - Status: ${status}`, { context });
      return { success: false, message: errMsg, status };
    }
  }
}

const MESSAGE_URL = 'https://app.idos.network/api/auth/message';
const VERIFY_URL = 'https://app.idos.network/api/auth/verify';
const CHECKIN_URL = 'https://app.idos.network/api/user-quests/complete';

async function readPrivateKeys() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    const pks = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    logger.info(`Loaded ${pks.length} private key${pks.length === 1 ? '' : 's'}`, { emoji: '📄 ' });
    return pks;
  } catch (error) {
    logger.error(`Failed to read pk.txt: ${error.message}`, { emoji: '❌ ' });
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) {
      logger.warn('No proxies found. Proceeding without proxy.', { emoji: '⚠️  ' });
    } else {
      logger.info(`Loaded ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'}`, { emoji: '🌐  ' });
    }
    return proxies;
  } catch (error) {
    logger.warn('proxy.txt not found.', { emoji: '⚠️ ' });
    return [];
  }
}

async function getPublicIP(proxy, context) {
  try {
    const config = getAxiosConfig(proxy);
    delete config.headers.authorization;
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 5, 5000, context);
    return response.response.ip || 'Unknown';
  } catch (error) {
    logger.error(`Failed to get IP: ${error.message}`, { emoji: '❌  ', context });
    return 'Error retrieving IP';
  }
}

async function getMessageAndNonce(address, proxy, context) {
  try {
    const payload = {
      publicAddress: address,
      publicKey: address
    };
    const res = await requestWithRetry('post', MESSAGE_URL, payload, getAxiosConfig(proxy), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return {
      message: res.response.message,
      nonce: res.response.nonce
    };
  } catch (error) {
    logger.error(`Failed to fetch message and nonce: ${error.message}`, { context });
    return null;
  }
}

async function performLogin(pk, proxy, context) {
  try {
    const wallet = new ethers.Wallet(pk);
    const address = wallet.address;

    const msgNonce = await getMessageAndNonce(address, proxy, context);
    if (!msgNonce) {
      throw new Error('Failed to get message and nonce');
    }

    const { message, nonce } = msgNonce;

    const signature = await wallet.signMessage(message);

    const payload = {
      publicAddress: address,
      publicKey: address,
      signature,
      message,
      nonce,
      walletType: 'evm'
    };

    const res = await requestWithRetry('post', VERIFY_URL, payload, getAxiosConfig(proxy), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response.accessToken;
  } catch (error) {
    logger.error(`Failed to perform login: ${error.message}`, { context });
    return null;
  }
}

function extractUserIdFromToken(accessToken) {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT');
    }
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddingLength = (4 - base64.length % 4) % 4;
    base64 += '='.repeat(paddingLength);
    const payload = Buffer.from(base64, 'base64').toString('utf-8');
    const jsonPayload = JSON.parse(payload);
    return jsonPayload.userId;
  } catch (error) {
    logger.error(`Failed to extract userId from token: ${error.message}`);
    return null;
  }
}

async function performCheckIn(userId, token, proxy, context) {
  try {
    const payload = {
      questName: 'daily_check',
      userId
    };
    const res = await requestWithRetry('post', CHECKIN_URL, payload, getAxiosConfig(proxy, token), 5, 5000, context);
    if (!res.success) {
      const errorMsg = res.message || 'Unknown error';
      const status = res.status || 'N/A';
      if (status === 502 || status === 409 || errorMsg.includes('Daily quest already completed today')) {
        logger.warn(`Already checked in: ${errorMsg} (Status: ${status})`, { emoji: '⚠️  ', context });
        return { alreadyChecked: true };
      } else {
        logger.error(`Check-in failed: ${errorMsg} (Status: ${status})`, { emoji: '❌  ', context });
        return null;
      }
    }
    return res.response;
  } catch (error) {
    logger.error(`Unexpected error during check-in: ${error.message}`, { context });
    return null;
  }
}

async function fetchUserPoints(userId, token, proxy, context) {
  try {
    const pointsUrl = `https://app.idos.network/api/user/${userId}/points`;
    const res = await requestWithRetry('get', pointsUrl, null, getAxiosConfig(proxy, token), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response.totalPoints || 'N/A';
  } catch (error) {
    logger.error(`Failed to fetch user points: ${error.message}`, { context });
    return 'N/A';
  }
}

async function processPrivateKey(pk, index, total, proxy = null) {
  const wallet = new ethers.Wallet(pk);
  const address = wallet.address;
  const context = `Account ${index + 1}/${total}`;
  logger.info(chalk.bold.magentaBright(`Starting account processing`), { emoji: '🚀 ', context });

  printHeader(`Account Info ${context}`);
  const ip = await getPublicIP(proxy, context);
  printInfo('IP', ip, context);
  printInfo('Address', address, context);
  console.log('\n');

  console.log('\n');
  logger.info('Starting login process...', { context });
  console.log('\n');

  const token = await performLogin(pk, proxy, context);
  if (!token) {
    logger.error('Login failed', { emoji: '❌  ', context });
    return;
  }
  logger.info(chalk.bold.greenBright('Login successful'), { emoji: '✅  ', context });

  const userId = extractUserIdFromToken(token);
  if (!userId) {
    logger.error('Failed to extract userId', { emoji: '❌  ', context });
    return;
  }

  console.log('\n');
  logger.info('Starting daily check-in process...', { context });
  console.log('\n');

  const checkInRes = await performCheckIn(userId, token, proxy, context);
  if (checkInRes && !checkInRes.alreadyChecked) {
    logger.info(chalk.bold.greenBright(`Check-in successful`), { emoji: '✅  ', context });
  }

  printHeader(`Account Stats ${context}`);
  const totalPoints = await fetchUserPoints(userId, token, proxy, context);
  printInfo('Address', address, context);
  printInfo('Total Points', totalPoints, context);

  logger.info(chalk.bold.greenBright(`Completed account processing`), { emoji: '🎉 ', context });
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  const useProxyAns = await askQuestion(chalk.cyanBright('🔌 Do You Want Use Proxy? (y/n): '));
  if (useProxyAns.trim().toLowerCase() === 'y') {
    globalUseProxy = true;
    globalProxies = await readProxies();
    if (globalProxies.length === 0) {
      globalUseProxy = false;
      logger.warn('No proxies available, proceeding without proxy.', { emoji: '⚠️ ' });
    }
  } else {
    logger.info('Proceeding without proxy.', { emoji: 'ℹ️ ' });
  }
}

async function runCycle() {
  const pks = await readPrivateKeys();
  if (pks.length === 0) {
    logger.error('No private keys found in pk.txt. Exiting cycle.', { emoji: '❌ ' });
    return;
  }

  for (let i = 0; i < pks.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      await processPrivateKey(pks[i], i, pks.length, proxy);
    } catch (error) {
      logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context: `Account ${i + 1}/${pks.length}` });
    }
    if (i < pks.length - 1) {
      console.log('\n\n');
    }
    await delay(5);
  }
}

async function run() {
  const terminalWidth = process.stdout.columns || 80;
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true
  });
  console.log(gradient.retro(centerText('=== Telegram Channel 🚀 : NT EXHAUST @NTExhaust ===', terminalWidth)));
  console.log(gradient.retro(centerText('✪ BOT IDOS AUTO DAILY CHECK-IN ✪', terminalWidth)));
  console.log('\n');
  await initializeConfig();

  while (true) {
    await runCycle();
    logger.info(chalk.bold.yellowBright('Cycle completed. Waiting 24 Hours...'), { emoji: '🔄 ' });
    await delay(86400);
  }
}

run().catch(error => logger.error(`Fatal error: ${error.message}`, { emoji: '❌' }));