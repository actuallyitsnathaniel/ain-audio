import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import aubitLogo from "/src/assets/images/projects/aubit-sound/aubit-logo.jpg";

// eslint-disable-next-line no-unused-vars
export const AubitSound = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="aubit-sound">
      <ProfilePic
        i={i}
        image={aubitLogo}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Aubit Sound"}
            subtitle="sample/sound library company"
          />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Aubit Sound"}
            subtitle="sample/sound library company"
          />
        }
        discography={
          <Discography>
            <Discography.Disc />
          </Discography>
        }
      />
    </div>
  );
};

AubitSound.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
