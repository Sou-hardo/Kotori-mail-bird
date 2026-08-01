import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
export function NotificationEmail({
  title = "A message needs your attention",
  body = "Kotori found a conversation that may need a reply.",
  href = "https://example.com/inbox",
}: {
  title?: string;
  body?: string;
  href?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body
        style={{
          backgroundColor: "#f6f7f4",
          fontFamily: "Arial,sans-serif",
          padding: "32px 12px",
        }}
      >
        <Container
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e6e8e3",
            borderRadius: "20px",
            padding: "32px",
            maxWidth: "560px",
          }}
        >
          <Text
            style={{
              color: "#168466",
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
            }}
          >
            Kotori Mail Bird
          </Text>
          <Heading style={{ color: "#17201b", fontSize: "28px" }}>
            {title}
          </Heading>
          <Text
            style={{ color: "#526158", fontSize: "16px", lineHeight: "25px" }}
          >
            {body}
          </Text>
          <Section style={{ marginTop: "28px" }}>
            <Button
              href={href}
              style={{
                backgroundColor: "#147d63",
                borderRadius: "10px",
                color: "#fff",
                padding: "13px 20px",
              }}
            >
              Review in Kotori
            </Button>
          </Section>
          <Text
            style={{ color: "#819087", fontSize: "12px", marginTop: "32px" }}
          >
            Kotori creates drafts only. Nothing is ever sent automatically.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
