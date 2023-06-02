/* Copyright (c) 2022 The Brave Authors. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/. */

package org.chromium.chrome.browser.crypto_wallet.util;

import android.content.Context;
import android.content.Intent;

import androidx.annotation.NonNull;

import org.chromium.brave_wallet.mojom.AccountId;
import org.chromium.brave_wallet.mojom.AccountInfo;
import org.chromium.brave_wallet.mojom.CoinType;
import org.chromium.brave_wallet.mojom.KeyringInfo;
import org.chromium.brave_wallet.mojom.SolanaTxData;
import org.chromium.brave_wallet.mojom.TxData1559;
import org.chromium.brave_wallet.mojom.TxDataUnion;
import org.chromium.chrome.R;
import org.chromium.mojo_base.mojom.TimeDelta;

import java.nio.ByteBuffer;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

public class WalletUtils {
    private static String getNewAccountPrefixForCoin(@CoinType.EnumType int coinType) {
        switch (coinType) {
            case CoinType.ETH:
                return "Ethereum";
            case CoinType.SOL:
                return "Solana";
            case CoinType.FIL:
                return "Filecoin";
            case CoinType.BTC:
                return "Bitcoin";
        }
        assert false;
        return "";
    }

    public static String timeDeltaToDateString(TimeDelta timeDelta) {
        DateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd hh:mm a", Locale.getDefault());
        return dateFormat.format(new Date(timeDelta.microseconds / 1000));
    }

    public static String generateUniqueAccountName(
            Context context, @CoinType.EnumType int coinType, AccountInfo[] accountInfos) {
        Set<String> allNames = Arrays.stream(accountInfos)
                                       .map(acc -> acc.name)
                                       .collect(Collectors.toCollection(HashSet::new));

        for (int number = 1; number < 1000; ++number) {
            String accountName = context.getString(R.string.new_account_prefix,
                    getNewAccountPrefixForCoin(coinType), String.valueOf(number));

            if (!allNames.contains(accountName)) {
                return accountName;
            }
        }
        return "";
    }

    public static boolean accountIdsEqual(AccountId left, AccountId right) {
        return left.serialize().equals(right.serialize());
    }
    public static boolean accountIdsEqual(AccountInfo left, AccountInfo right) {
        return accountIdsEqual(left.accountId, right.accountId);
    }

    public static int getSelectedAccountIndex(
            AccountInfo accountInfo, List<AccountInfo> accountInfos) {
        if (accountInfo == null || accountInfos.size() == 0) return -1;
        for (int i = 0; i < accountInfos.size(); i++) {
            AccountInfo account = accountInfos.get(i);
            if (accountIdsEqual(account, accountInfo)) {
                return i;
            }
        }
        return 0;
    }

    public static TxDataUnion toTxDataUnion(SolanaTxData solanaTxData) {
        TxDataUnion txDataUnion = new TxDataUnion();
        txDataUnion.setSolanaTxData(solanaTxData);
        return txDataUnion;
    }

    private static final String ACCOUNT_INFO = "accountInfo";

    public static void addAccountInfoToIntent(
            @NonNull Intent intent, @NonNull AccountInfo accountInfo) {
        intent.putExtra(ACCOUNT_INFO, accountInfo.serialize().array());
    }

    public static AccountInfo getAccountInfoFromIntent(@NonNull Intent intent) {
        byte[] bytes = intent.getByteArrayExtra(ACCOUNT_INFO);
        if (bytes == null) {
            return null;
        }
        return AccountInfo.deserialize(ByteBuffer.wrap(bytes));
    }
}
