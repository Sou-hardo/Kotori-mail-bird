export type AddressedMessage = {
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
};

export function emailAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

export function replyAllRecipients(message: AddressedMessage, owner: string) {
  const ownerAddress = emailAddress(owner);
  const sender = emailAddress(message.fromAddress);
  if (sender === ownerAddress) return null;
  const seen = new Set<string>();
  const unique = (values: string[]) =>
    values.filter((value) => {
      const address = emailAddress(value);
      if (!address || address === ownerAddress || seen.has(address))
        return false;
      seen.add(address);
      return true;
    });
  const to = unique([message.fromAddress, ...message.toAddresses]);
  const cc = unique(message.ccAddresses);
  return { to, cc };
}

export function latestInbound<T extends AddressedMessage>(
  messages: T[],
  owner: string,
) {
  return [...messages]
    .reverse()
    .find(
      (message) => emailAddress(message.fromAddress) !== emailAddress(owner),
    );
}
